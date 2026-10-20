import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderBook } from './OrderBook.js';
import { Order } from './Order.js';

test('OrderBook: Limit Order Placed and Resting', () => {
  const book = new OrderBook('BTC-USD');
  const order = new Order({
    id: 'ord-1',
    userId: 'user-alice',
    symbol: 'BTC-USD',
    side: 'BUY',
    type: 'LIMIT',
    price: 60000,
    amount: 1.5
  });

  const { trades, remainingOrder } = book.processOrder(order);
  assert.equal(trades.length, 0);
  assert.equal(remainingOrder.status, 'NEW');
  assert.equal(remainingOrder.remaining, 1.5);

  const depth = book.getL2Depth(5);
  assert.equal(depth.bids.length, 1);
  assert.deepEqual(depth.bids[0], [60000, 1.5]);
});

test('OrderBook: Price-Time Priority Matching (FIFO)', () => {
  const book = new OrderBook('BTC-USD');

  // Place resting asks (sell orders)
  const ask1 = new Order({
    id: 'ask-1',
    userId: 'user-bob',
    symbol: 'BTC-USD',
    side: 'SELL',
    type: 'LIMIT',
    price: 65000,
    amount: 1.0
  });

  const ask2 = new Order({
    id: 'ask-2',
    userId: 'user-charlie',
    symbol: 'BTC-USD',
    side: 'SELL',
    type: 'LIMIT',
    price: 65000,
    amount: 2.0
  });

  book.processOrder(ask1);
  book.processOrder(ask2);

  // Incoming taker buy sweeps through FIFO
  const takerBuy = new Order({
    id: 'buy-1',
    userId: 'user-alice',
    symbol: 'BTC-USD',
    side: 'BUY',
    type: 'LIMIT',
    price: 65000,
    amount: 1.5
  });

  const { trades, remainingOrder } = book.processOrder(takerBuy);
  assert.equal(trades.length, 2);
  assert.equal(trades[0].makerOrderId, 'ask-1');
  assert.equal(trades[0].amount, 1.0); // Bob completely filled first
  assert.equal(trades[1].makerOrderId, 'ask-2');
  assert.equal(trades[1].amount, 0.5); // Charlie partially filled

  assert.equal(remainingOrder.status, 'FILLED');
  assert.equal(remainingOrder.remaining, 0);

  const depth = book.getL2Depth(5);
  assert.deepEqual(depth.asks[0], [65000, 1.5]); // 2.0 - 0.5 = 1.5 remaining
});

test('OrderBook: Market Order Sweeps Book Depth', () => {
  const book = new OrderBook('ETH-USD');

  book.processOrder(new Order({
    id: 'ask-1',
    userId: 'user-1',
    symbol: 'ETH-USD',
    side: 'SELL',
    type: 'LIMIT',
    price: 3000,
    amount: 10
  }));

  book.processOrder(new Order({
    id: 'ask-2',
    userId: 'user-2',
    symbol: 'ETH-USD',
    side: 'SELL',
    type: 'LIMIT',
    price: 3050,
    amount: 10
  }));

  const marketBuy = new Order({
    id: 'mkt-buy-1',
    userId: 'user-whale',
    symbol: 'ETH-USD',
    side: 'BUY',
    type: 'MARKET',
    amount: 15
  });

  const { trades, remainingOrder } = book.processOrder(marketBuy);
  assert.equal(trades.length, 2);
  assert.equal(trades[0].price, 3000);
  assert.equal(trades[0].amount, 10);
  assert.equal(trades[1].price, 3050);
  assert.equal(trades[1].amount, 5);
  assert.equal(remainingOrder.status, 'FILLED');

  const depth = book.getL2Depth(5);
  assert.deepEqual(depth.asks[0], [3050, 5]);
});

test('OrderBook: Order Cancellation', () => {
  const book = new OrderBook('BTC-USD');
  const order = new Order({
    id: 'cancel-test',
    userId: 'user-1',
    symbol: 'BTC-USD',
    side: 'BUY',
    type: 'LIMIT',
    price: 50000,
    amount: 5
  });

  book.processOrder(order);
  assert.equal(book.getL2Depth(5).bids.length, 1);

  const cancelled = book.cancelOrder('cancel-test');
  assert.ok(cancelled);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(book.getL2Depth(5).bids.length, 0);
});
