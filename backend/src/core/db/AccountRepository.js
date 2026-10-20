/**
 * AccountRepository.js
 * Persistent ledger account & journal storage using SQLite.
 * Replaces in-memory DoubleEntryLedger Map for production durability.
 * (#33 Event Sourcing / WAL, #36 Migrations, #26 DB Indexing)
 */
import db from './database.js';
import crypto from 'crypto';

export class AccountRepository {
  // ────────────────────────────────────────────────────
  // Account CRUD
  // ────────────────────────────────────────────────────

  upsertAccount({ id, userId, currency, type = 'ASSET', initialBalance = 0 }) {
    db.prepare(`
      INSERT INTO accounts (id, user_id, currency, type, available)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, currency) DO NOTHING
    `).run(id, userId, currency.toUpperCase(), type, initialBalance);
    return this.findById(id);
  }

  findById(id) {
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  findByUserAndCurrency(userId, currency) {
    return db.prepare('SELECT * FROM accounts WHERE user_id = ? AND currency = ? COLLATE NOCASE').get(userId, currency);
  }

  findByUser(userId) {
    return db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY currency').all(userId);
  }

  // ────────────────────────────────────────────────────
  // Balance mutations (atomic, transactional)
  // ────────────────────────────────────────────────────

  /**
   * Lock (reserve) funds: move available → locked
   * Used before order placement or withdrawal initiation
   */
  lockFunds(accountId, amount) {
    const acc = this.findById(accountId);
    if (!acc) throw new Error(`Account ${accountId} not found`);
    if (acc.available < amount) throw new Error(`Insufficient balance: available=${acc.available}, requested=${amount}`);

    db.prepare(`
      UPDATE accounts
      SET available = available - ?, locked = locked + ?, version = version + 1, updated_at = datetime('now')
      WHERE id = ? AND available >= ?
    `).run(amount, amount, accountId, amount);
  }

  /**
   * Release locked funds back to available (order cancel / saga compensation)
   */
  releaseFunds(accountId, amount) {
    db.prepare(`
      UPDATE accounts
      SET locked = MAX(0, locked - ?), available = available + ?, version = version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(amount, amount, accountId);
  }

  /**
   * Debit from locked (confirm settlement)
   */
  debitLocked(accountId, amount) {
    const acc = this.findById(accountId);
    if (!acc || acc.locked < amount) throw new Error(`Insufficient locked funds in ${accountId}`);
    db.prepare(`
      UPDATE accounts
      SET locked = locked - ?, version = version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(amount, accountId);
  }

  /**
   * Credit to available (trade settlement, deposit)
   */
  credit(accountId, amount) {
    db.prepare(`
      UPDATE accounts
      SET available = available + ?, version = version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(amount, accountId);
  }

  /**
   * Debit from available (direct)
   */
  debit(accountId, amount) {
    const acc = this.findById(accountId);
    if (!acc || acc.available < amount) throw new Error(`Insufficient funds in account ${accountId}`);
    db.prepare(`
      UPDATE accounts
      SET available = available - ?, version = version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(amount, accountId);
  }

  // ────────────────────────────────────────────────────
  // Journal (Double-Entry)
  // ────────────────────────────────────────────────────

  /**
   * Record a double-entry journal entry (atomic debit + credit)
   */
  recordJournal({ type, debitAccountId, creditAccountId, amount, currency, referenceId, referenceType, metadata }) {
    const id = `jnl-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO journal_entries (id, type, debit_account, credit_account, amount, currency, reference_id, reference_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, debitAccountId, creditAccountId, amount, currency.toUpperCase(), referenceId || null, referenceType || null, metadata ? JSON.stringify(metadata) : null);
    return id;
  }

  getJournals({ userId, currency, limit = 50, offset = 0 } = {}) {
    let query = 'SELECT * FROM journal_entries';
    const params = [];
    if (userId || currency) {
      query += ' WHERE';
      if (userId) {
        query += ` (debit_account IN (SELECT id FROM accounts WHERE user_id = ?) OR credit_account IN (SELECT id FROM accounts WHERE user_id = ?))`;
        params.push(userId, userId);
      }
      if (currency) {
        query += (userId ? ' AND' : '') + ` currency = ?`;
        params.push(currency.toUpperCase());
      }
    }
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    return db.prepare(query).all(...params);
  }

  journalCount() {
    return db.prepare('SELECT COUNT(*) as count FROM journal_entries').get().count;
  }
}

export const accountRepository = new AccountRepository();
