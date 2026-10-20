/**
 * Account.js
 * In-memory ledger account with optimistic locking versioning
 * (#36 Optimistic Locking, #37 Pessimistic Locking)
 */
export class Account {
  /**
   * @param {Object} params
   * @param {string} params.id
   * @param {string} params.userId
   * @param {string} params.currency - e.g. 'USD', 'BTC', 'ETH'
   * @param {'ASSET' | 'LIABILITY' | 'EQUITY'} params.type
   * @param {number} [params.initialBalance=0]
   */
  constructor({ id, userId, currency, type, initialBalance = 0 }) {
    this.id = id;
    this.userId = userId;
    this.currency = currency;
    this.type = type;
    this.available = Number(initialBalance);
    this.locked = 0;
    this.version = 1n; // Optimistic locking version (#36)
  }

  /**
   * Locks funds for an open limit order
   * @param {number} amount
   * @param {bigint} [expectedVersion]
   */
  lockFunds(amount, expectedVersion = null) {
    if (expectedVersion !== null && this.version !== expectedVersion) {
      throw new Error(`OptimisticLockConflict: expected v${expectedVersion}, actual v${this.version}`);
    }
    if (this.available < amount) {
      throw new Error(`Insufficient funds: available ${this.available} ${this.currency}, requested ${amount}`);
    }

    this.available -= amount;
    this.locked += amount;
    this.version += 1n;
  }

  /**
   * Unlocks funds (e.g. order cancelled)
   * @param {number} amount
   */
  unlockFunds(amount) {
    if (this.locked < amount) {
      throw new Error(`Cannot unlock ${amount}: only ${this.locked} locked`);
    }

    this.locked -= amount;
    this.available += amount;
    this.version += 1n;
  }

  /**
   * Settles locked funds (trade executed)
   * @param {number} amount
   */
  deductLocked(amount) {
    if (this.locked < amount) {
      throw new Error(`Cannot deduct ${amount}: only ${this.locked} locked`);
    }

    this.locked -= amount;
    this.version += 1n;
  }

  /**
   * Credit incoming funds
   * @param {number} amount
   */
  credit(amount) {
    if (amount <= 0) throw new Error('Credit amount must be positive');
    this.available += amount;
    this.version += 1n;
  }
}
