import { OrderBook } from '../models/index.js';
import { Order } from '../models/index.js';

class MatchingEngineService {
  constructor() {
    this.books = new Map();
    this.initSymbols(['BTC-USD', 'ETH-USD', 'SOL-USD']);
    this._seedLiquidity();
  }

  initSymbols(symbols) {
    for (const sym of symbols) {
      this.books.set(sym, new OrderBook(sym));
    }
  }

  getOrderBook(symbol) {
    const book = this.books.get(symbol.toUpperCase());
    if (!book) throw new Error(`Trading pair '${symbol}' not supported`);
    return book;
  }

  getL2Depth(symbol, levels = 25) {
    const book = this.getOrderBook(symbol);
    return book.getL2Depth(levels);
  }

  placeOrder({ id, userId, symbol, side, type, price, amount, timeInForce, idempotencyKey }) {
    const book = this.getOrderBook(symbol);
    const order = new Order({
      id: id || `ord-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      userId,
      symbol: symbol.toUpperCase(),
      side,
      type,
      price,
      amount,
      timeInForce,
      idempotencyKey
    });

    const { trades, remainingOrder } = book.processOrder(order);
    return { order: remainingOrder, trades };
  }

  cancelOrder(symbol, orderId) {
    const book = this.getOrderBook(symbol);
    const cancelled = book.cancelOrder(orderId);
    if (!cancelled) throw new Error(`Order ${orderId} not found or already filled`);
    return cancelled;
  }

  getAllSymbols() {
    return Array.from(this.books.keys()).map(sym => {
      const b = this.books.get(sym);
      return {
        symbol: sym,
        sequence: b.sequence.toString(),
        openOrdersCount: b.orders.size
      };
    });
  }

  _seedLiquidity() {
    const btc = this.books.get('BTC-USD');
    const basePrice = 64250;
    for (let i = 1; i <= 15; i++) {
      btc.processOrder(new Order({
        id: `seed-bid-${i}`,
        userId: 'liquidity-provider-1',
        symbol: 'BTC-USD',
        side: 'BUY',
        type: 'LIMIT',
        price: basePrice - (i * 20),
        amount: Number((0.5 + i * 0.15).toFixed(4))
      }));

      btc.processOrder(new Order({
        id: `seed-ask-${i}`,
        userId: 'liquidity-provider-2',
        symbol: 'BTC-USD',
        side: 'SELL',
        type: 'LIMIT',
        price: basePrice + (i * 20),
        amount: Number((0.5 + i * 0.15).toFixed(4))
      }));
    }
  }
}

export const matchingEngineService = new MatchingEngineService();
