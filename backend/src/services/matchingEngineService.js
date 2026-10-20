import { OrderBook } from '../models/index.js';
import { Order } from '../models/index.js';

class MatchingEngineService {
  constructor() {
    this.books = new Map();
    this.initSymbols([
      'BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD',
      'ADA-USD', 'DOGE-USD', 'AVAX-USD', 'LINK-USD', 'UNI-USD'
    ]);
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
    const markets = [
      { sym: 'BTC-USD', price: 64550.00, step: 15.0,  qtyMin: 0.1,   qtyStep: 0.05, dec: 2 },
      { sym: 'ETH-USD', price:  3430.00, step:  1.5,  qtyMin: 1.0,   qtyStep: 0.35, dec: 2 },
      { sym: 'SOL-USD', price:   168.50, step:  0.15, qtyMin: 5.0,   qtyStep: 1.2,  dec: 2 },
      { sym: 'BNB-USD', price:   575.00, step:  0.4,  qtyMin: 2.0,   qtyStep: 0.5,  dec: 2 },
      { sym: 'XRP-USD', price:     0.5518, step: 0.0005, qtyMin: 500, qtyStep: 100, dec: 4 },
      { sym: 'ADA-USD', price:     0.4900, step: 0.0005, qtyMin: 400, qtyStep: 80,  dec: 4 },
      { sym: 'DOGE-USD', price:    0.1755, step: 0.0003, qtyMin: 1000, qtyStep: 200, dec: 4 },
      { sym: 'AVAX-USD', price:    38.99, step:  0.05, qtyMin: 15.0, qtyStep: 3.0, dec: 2 },
      { sym: 'LINK-USD', price:    14.78, step:  0.02, qtyMin: 30.0, qtyStep: 5.0, dec: 2 },
      { sym: 'UNI-USD',  price:     8.84, step:  0.01, qtyMin: 50.0, qtyStep: 8.0, dec: 2 },
    ];

    for (const m of markets) {
      const book = this.books.get(m.sym);
      if (!book) continue;
      for (let i = 1; i <= 15; i++) {
        const bidPrice = Number((m.price - (i * m.step)).toFixed(m.dec));
        const askPrice = Number((m.price + (i * m.step)).toFixed(m.dec));
        const amount   = Number((m.qtyMin + i * m.qtyStep).toFixed(4));

        book.processOrder(new Order({
          id: `seed-bid-${m.sym}-${i}`,
          userId: 'liquidity-provider-1',
          symbol: m.sym,
          side: 'BUY',
          type: 'LIMIT',
          price: bidPrice,
          amount
        }));

        book.processOrder(new Order({
          id: `seed-ask-${m.sym}-${i}`,
          userId: 'liquidity-provider-2',
          symbol: m.sym,
          side: 'SELL',
          type: 'LIMIT',
          price: askPrice,
          amount
        }));
      }
    }
  }
}

export const matchingEngineService = new MatchingEngineService();
