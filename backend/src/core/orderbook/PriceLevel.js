/**
 * PriceLevel.js
 * Implements a FIFO queue of orders at a specific price point.
 * Guarantees Price-Time Priority (#91 Latency, #92 Throughput)
 */
export class PriceLevel {
  /**
   * @param {number} price
   */
  constructor(price) {
    this.price = Number(price);
    this.totalVolume = 0;
    this.orderCount = 0;
    this.orders = []; // FIFO queue
  }

  /**
   * Append order to end of queue (Time Priority)
   * @param {import('./Order.js').Order} order
   */
  addOrder(order) {
    this.orders.push(order);
    this.totalVolume += order.remaining;
    this.orderCount += 1;
  }

  /**
   * Remove order by ID (e.g. cancellation)
   * @param {string} orderId
   * @returns {import('./Order.js').Order | null}
   */
  removeOrder(orderId) {
    const idx = this.orders.findIndex(o => o.id === orderId);
    if (idx === -1) return null;

    const [removed] = this.orders.splice(idx, 1);
    this.totalVolume -= removed.remaining;
    this.orderCount -= 1;
    return removed;
  }

  /**
   * Peek front of FIFO queue
   * @returns {import('./Order.js').Order | null}
   */
  peek() {
    return this.orders[0] || null;
  }

  /**
   * Dequeue front of queue
   * @returns {import('./Order.js').Order | null}
   */
  shift() {
    const order = this.orders.shift();
    if (order) {
      this.orderCount -= 1;
    }
    return order || null;
  }

  /**
   * Update volume when an order at this level is partially filled
   * @param {number} filledQty
   */
  reduceVolume(filledQty) {
    this.totalVolume = Math.max(0, this.totalVolume - filledQty);
  }

  isEmpty() {
    return this.orders.length === 0;
  }
}
