/**
 * TransactionRepository.js
 * Persistent deposit/withdrawal transaction storage.
 * Handles Stripe, blockchain, and bank rail records with AML scoring.
 * (#15 Message Queues, #18 Distributed Tx, #19 Saga, #20 DLQ, #72 Encryption)
 */
import db from './database.js';
import crypto from 'crypto';

export class TransactionRepository {
  /**
   * Create a new transaction record (starts as PENDING)
   */
  create({ userId, type, currency, amount, fee = 0, rail = 'INTERNAL', externalRef, address, sagaId, amlScore = 0 }) {
    const id = `tx-${crypto.randomUUID()}`;
    const netAmount = type === 'DEPOSIT' ? amount - fee : amount + fee;
    db.prepare(`
      INSERT INTO transactions
        (id, user_id, type, currency, amount, fee, net_amount, status, rail, external_ref, address, saga_id, aml_score, aml_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
    `).run(id, userId, type.toUpperCase(), currency.toUpperCase(), amount, fee, netAmount, rail, externalRef || null, address || null, sagaId || null, amlScore, amlScore > 70 ? 1 : 0);
    return this.findById(id);
  }

  findById(id) {
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  }

  findByUser(userId, { limit = 50, offset = 0, type } = {}) {
    if (type) {
      return db.prepare('SELECT * FROM transactions WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, type, limit, offset);
    }
    return db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limit, offset);
  }

  findByStripePaymentIntent(piId) {
    return db.prepare('SELECT * FROM transactions WHERE stripe_pi_id = ?').get(piId);
  }

  findByBlockchainHash(hash) {
    return db.prepare('SELECT * FROM transactions WHERE blockchain_hash = ?').get(hash);
  }

  /**
   * Update transaction status (PENDING → CONFIRMING → COMPLETED | FAILED)
   */
  updateStatus(id, status, extras = {}) {
    const fields = ['status = ?', 'updated_at = datetime(\'now\')'];
    const values = [status];

    if (extras.blockchainHash) { fields.push('blockchain_hash = ?'); values.push(extras.blockchainHash); }
    if (extras.confirmations !== undefined) { fields.push('confirmations = ?'); values.push(extras.confirmations); }
    if (extras.stripePiId) { fields.push('stripe_pi_id = ?'); values.push(extras.stripePiId); }
    if (extras.bankRef) { fields.push('bank_ref = ?'); values.push(extras.bankRef); }
    if (extras.amlScore !== undefined) { fields.push('aml_score = ?, aml_flag = ?'); values.push(extras.amlScore, extras.amlScore > 70 ? 1 : 0); }

    values.push(id);
    db.prepare(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  /**
   * Get pending blockchain deposits awaiting confirmation
   */
  getPendingBlockchain() {
    return db.prepare(`SELECT * FROM transactions WHERE type = 'DEPOSIT' AND rail = 'BLOCKCHAIN' AND status IN ('PENDING', 'CONFIRMING')`).all();
  }

  /**
   * List all flagged AML transactions
   */
  getAMLFlagged() {
    return db.prepare('SELECT * FROM transactions WHERE aml_flag = 1 ORDER BY created_at DESC').all();
  }

  /**
   * Stats for risk dashboard
   */
  getStats(userId) {
    return db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN type='DEPOSIT' THEN net_amount ELSE 0 END) as total_deposited,
        SUM(CASE WHEN type='WITHDRAWAL' THEN net_amount ELSE 0 END) as total_withdrawn,
        SUM(CASE WHEN aml_flag=1 THEN 1 ELSE 0 END) as aml_flags
      FROM transactions WHERE user_id = ?
    `).get(userId);
  }
}

export const transactionRepository = new TransactionRepository();
