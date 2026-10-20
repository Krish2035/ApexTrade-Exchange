/**
 * Order.js
 * Domain model representing an order on the exchange.
 * Supports Price-Time Priority (#91 Latency, #92 Throughput)
 */
export class Order {
  /**
   * @param {Object} params
   * @param {string} params.id
   * @param {string} params.userId
   * @param {string} params.symbol
   * @param {'BUY' | 'SELL'} params.side
   * @param {'LIMIT' | 'MARKET'} params.type
   * @param {number} [params.price=0]
   * @param {number} params.amount
   * @param {'GTC' | 'IOC' | 'FOK'} [params.timeInForce='GTC']
   * @param {string} [params.idempotencyKey]
   */
  constructor({
    id,
    userId,
    symbol,
    side,
    type,
    price = 0,
    amount,
    timeInForce = 'GTC',
    idempotencyKey = null
  }) {
    if (!id) throw new Error('Order ID is required');
    if (!userId) throw new Error('User ID is required');
    if (!['BUY', 'SELL'].includes(side)) throw new Error(`Invalid side: ${side}`);
    if (!['LIMIT', 'MARKET'].includes(type)) throw new Error(`Invalid type: ${type}`);
    if (amount <= 0) throw new Error('Order amount must be positive');
    if (type === 'LIMIT' && price <= 0) throw new Error('Limit price must be positive');

    this.id = id;
    this.userId = userId;
    this.symbol = symbol;
    this.side = side;
    this.type = type;
    this.price = Number(price);
    this.amount = Number(amount);
    this.filled = 0;
    this.remaining = Number(amount);
    this.timeInForce = timeInForce;
    this.idempotencyKey = idempotencyKey;
    this.status = 'NEW';
    this.timestamp = process.hrtime.bigint(); // Ultra-high precision for deterministic FIFO ordering
    this.createdAt = new Date();
  }

  /**
   * Executes a partial or full fill on the order
   * @param {number} fillQty
   * @returns {number} Actual executed quantity
   */
  fill(fillQty) {
    const executed = Math.min(this.remaining, fillQty);
    this.filled += executed;
    this.remaining -= executed;

    if (this.remaining <= 1e-9) {
      this.remaining = 0;
      this.status = 'FILLED';
    } else {
      this.status = 'PARTIALLY_FILLED';
    }

    return executed;
  }

  /**
   * Cancels remaining quantity on order
   */
  cancel() {
    if (this.status === 'FILLED' || this.status === 'CANCELLED') {
      return false;
    }
    this.status = 'CANCELLED';
    return true;
  }
}
