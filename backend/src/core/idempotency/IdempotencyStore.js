/**
 * IdempotencyStore.js
 * Tracks idempotent requests to guarantee exactly-once processing
 * across retries, network dropouts, and timeouts.
 * (#14 Idempotency, #12 Retries, #39 Race Conditions)
 */
export class IdempotencyStore {
  /**
   * @param {Object} [options]
   * @param {number} [options.ttlMs=86400000] - Default 24 hours
   */
  constructor({ ttlMs = 86400000 } = {}) {
    this.ttlMs = ttlMs;
    this.store = new Map(); // key -> { status: 'PENDING' | 'RESOLVED' | 'FAILED', response, expiresAt }
  }

  /**
   * Attempts to start an idempotent operation
   * @param {string} key
   * @returns {{ proceed: boolean, cachedResponse?: any }}
   */
  start(key) {
    if (!key) throw new Error('Idempotency key required');
    const now = Date.now();
    const record = this.store.get(key);

    if (record && record.expiresAt > now) {
      if (record.status === 'PENDING') {
        throw new Error(`ConcurrentRequestConflict: Request with key '${key}' is currently being processed`);
      }
      return { proceed: false, cachedResponse: record.response };
    }

    // Register as PENDING
    this.store.set(key, {
      status: 'PENDING',
      response: null,
      expiresAt: now + this.ttlMs
    });

    return { proceed: true };
  }

  /**
   * Marks key as successfully RESOLVED with cached response
   * @param {string} key
   * @param {any} response
   */
  resolve(key, response) {
    const record = this.store.get(key);
    if (record) {
      record.status = 'RESOLVED';
      record.response = response;
    }
  }

  /**
   * Marks key as FAILED so client can retry safely
   * @param {string} key
   */
  reject(key) {
    this.store.delete(key);
  }
}
