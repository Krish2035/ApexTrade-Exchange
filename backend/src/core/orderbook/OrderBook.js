import { PriceLevel } from './PriceLevel.js';
import crypto from 'crypto';

/**
 * OrderBook.js
 * In-memory L2/L3 order book engine supporting Limit & Market orders,
 * GTC/IOC/FOK time-in-force, price-time priority, and sub-millisecond execution.
 * (#91 Latency, #92 Throughput, #93 P99 Latency)
 */
export class OrderBook {
  /**
   * @param {string} symbol - Trading pair (e.g. 'BTC-USD')
   */
  constructor(symbol) {
    this.symbol = symbol;

    // Bids: Sorted Descending (Highest buy price first)
    this.bids = new Map(); // price -> PriceLevel
    this.bidPrices = [];   // Sorted array descending

    // Asks: Sorted Ascending (Lowest sell price first)
    this.asks = new Map(); // price -> PriceLevel
    this.askPrices = [];   // Sorted array ascending

    // O(1) order lookup for status & cancellation (#39 Race Conditions)
    this.orders = new Map(); // orderId -> { order, priceLevel }
    
    this.sequence = 0n; // Monotonic sequence number for event sourcing
  }

  /**
   * Main entry point: Process an incoming order against the book.
   * @param {import('./Order.js').Order} takerOrder
   * @returns {{ trades: Array<any>, remainingOrder: import('./Order.js').Order }}
   */
  processOrder(takerOrder) {
    if (takerOrder.symbol !== this.symbol) {
      throw new Error(`Symbol mismatch: book ${this.symbol} vs order ${takerOrder.symbol}`);
    }

    this.sequence += 1n;
    const trades = [];

    // FOK (Fill-Or-Kill) Pre-check: If full quantity cannot be filled, reject immediately
    if (takerOrder.timeInForce === 'FOK') {
      if (!this._canFullyFill(takerOrder)) {
        takerOrder.status = 'REJECTED';
        return { trades, remainingOrder: takerOrder };
      }
    }

    // Match taker order against opposing resting book
    if (takerOrder.side === 'BUY') {
      this._matchTakerBuy(takerOrder, trades);
    } else {
      this._matchTakerSell(takerOrder, trades);
    }

    // Handle remaining quantity
    if (takerOrder.remaining > 0) {
      if (takerOrder.type === 'LIMIT' && takerOrder.timeInForce === 'GTC') {
        // Rest on book as a Maker order
        this._addRestingOrder(takerOrder);
      } else {
        // Market orders and IOC orders immediately cancel unfilled tails
        takerOrder.cancel();
      }
    }

    return { trades, remainingOrder: takerOrder };
  }

  /**
   * Match incoming BUY order against resting ASKS
   */
  _matchTakerBuy(takerOrder, trades) {
    while (takerOrder.remaining > 0 && this.askPrices.length > 0) {
      const bestAskPrice = this.askPrices[0];

      // If taker limit order is lower than lowest ask, cannot match further
      if (takerOrder.type === 'LIMIT' && takerOrder.price < bestAskPrice) {
        break;
      }

      const level = this.asks.get(bestAskPrice);
      while (takerOrder.remaining > 0 && !level.isEmpty()) {
        const makerOrder = level.peek();
        const tradePrice = makerOrder.price; // Maker gets price priority
        const matchQty = Math.min(takerOrder.remaining, makerOrder.remaining);

        // Execute fills
        takerOrder.fill(matchQty);
        makerOrder.fill(matchQty);
        level.reduceVolume(matchQty);

        trades.push({
          id: crypto.randomUUID(),
          sequence: this.sequence.toString(),
          symbol: this.symbol,
          price: tradePrice,
          amount: matchQty,
          makerOrderId: makerOrder.id,
          takerOrderId: takerOrder.id,
          makerUserId: makerOrder.userId,
          takerUserId: takerOrder.userId,
          takerSide: 'BUY',
          timestamp: Date.now()
        });

        // If maker order is completely filled, remove it from queue
        if (makerOrder.remaining === 0) {
          level.shift();
          this.orders.delete(makerOrder.id);
        }
      }

      // If this price level has been depleted, prune it
      if (level.isEmpty()) {
        this.asks.delete(bestAskPrice);
        this.askPrices.shift();
      }
    }
  }

  /**
   * Match incoming SELL order against resting BIDS
   */
  _matchTakerSell(takerOrder, trades) {
    while (takerOrder.remaining > 0 && this.bidPrices.length > 0) {
      const bestBidPrice = this.bidPrices[0];

      // If taker limit order is higher than highest bid, cannot match further
      if (takerOrder.type === 'LIMIT' && takerOrder.price > bestBidPrice) {
        break;
      }

      const level = this.bids.get(bestBidPrice);
      while (takerOrder.remaining > 0 && !level.isEmpty()) {
        const makerOrder = level.peek();
        const tradePrice = makerOrder.price; // Maker gets price priority
        const matchQty = Math.min(takerOrder.remaining, makerOrder.remaining);

        takerOrder.fill(matchQty);
        makerOrder.fill(matchQty);
        level.reduceVolume(matchQty);

        trades.push({
          id: crypto.randomUUID(),
          sequence: this.sequence.toString(),
          symbol: this.symbol,
          price: tradePrice,
          amount: matchQty,
          makerOrderId: makerOrder.id,
          takerOrderId: takerOrder.id,
          makerUserId: makerOrder.userId,
          takerUserId: takerOrder.userId,
          takerSide: 'SELL',
          timestamp: Date.now()
        });

        if (makerOrder.remaining === 0) {
          level.shift();
          this.orders.delete(makerOrder.id);
        }
      }

      if (level.isEmpty()) {
        this.bids.delete(bestBidPrice);
        this.bidPrices.shift();
      }
    }
  }

  /**
   * Place an unfilled limit order onto the resting book
   */
  _addRestingOrder(order) {
    const isBuy = order.side === 'BUY';
    const map = isBuy ? this.bids : this.asks;
    const prices = isBuy ? this.bidPrices : this.askPrices;

    let level = map.get(order.price);
    if (!level) {
      level = new PriceLevel(order.price);
      map.set(order.price, level);
      this._insertSortedPrice(prices, order.price, isBuy);
    }

    level.addOrder(order);
    this.orders.set(order.id, { order, level });
  }

  /**
   * Inserts price in sorted order using binary search for speed
   */
  _insertSortedPrice(prices, price, isDescending) {
    let low = 0;
    let high = prices.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const compare = isDescending
        ? prices[mid] < price  // Descending (Bids: 100, 99, 98...)
        : prices[mid] > price; // Ascending (Asks: 101, 102, 103...)

      if (compare) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    prices.splice(low, 0, price);
  }

  /**
   * Cancels a resting order by orderId
   * @param {string} orderId
   * @returns {import('./Order.js').Order | null}
   */
  cancelOrder(orderId) {
    const entry = this.orders.get(orderId);
    if (!entry) return null;

    const { order, level } = entry;
    level.removeOrder(orderId);
    order.cancel();
    this.orders.delete(orderId);

    // If level is now empty, remove price
    if (level.isEmpty()) {
      const isBuy = order.side === 'BUY';
      const map = isBuy ? this.bids : this.asks;
      const prices = isBuy ? this.bidPrices : this.askPrices;

      map.delete(order.price);
      const pIdx = prices.indexOf(order.price);
      if (pIdx !== -1) prices.splice(pIdx, 1);
    }

    return order;
  }

  /**
   * Pre-check for FOK orders
   */
  _canFullyFill(order) {
    let remainingToFill = order.amount;
    const isBuy = order.side === 'BUY';
    const prices = isBuy ? this.askPrices : this.bidPrices;
    const map = isBuy ? this.asks : this.bids;

    for (const price of prices) {
      if (order.type === 'LIMIT') {
        if (isBuy && price > order.price) break;
        if (!isBuy && price < order.price) break;
      }

      const level = map.get(price);
      remainingToFill -= level.totalVolume;
      if (remainingToFill <= 0) return true;
    }

    return false;
  }

  /**
   * Extract Level 2 Market Depth snapshot (#49 Edge Caching, #22 WebSockets)
   * @param {number} depthLevels
   */
  getL2Depth(depthLevels = 20) {
    const bidsSnapshot = [];
    const asksSnapshot = [];

    const bidSlice = this.bidPrices.slice(0, depthLevels);
    for (const price of bidSlice) {
      const level = this.bids.get(price);
      if (level && level.totalVolume > 0) {
        bidsSnapshot.push([price, Number(level.totalVolume.toFixed(8))]);
      }
    }

    const askSlice = this.askPrices.slice(0, depthLevels);
    for (const price of askSlice) {
      const level = this.asks.get(price);
      if (level && level.totalVolume > 0) {
        asksSnapshot.push([price, Number(level.totalVolume.toFixed(8))]);
      }
    }

    const bestBid = this.bidPrices[0] || null;
    const bestAsk = this.askPrices[0] || null;
    const spread = (bestBid && bestAsk) ? Number((bestAsk - bestBid).toFixed(4)) : null;

    return {
      symbol: this.symbol,
      sequence: this.sequence.toString(),
      bestBid,
      bestAsk,
      spread,
      bids: bidsSnapshot,
      asks: asksSnapshot,
      timestamp: Date.now()
    };
  }
}
