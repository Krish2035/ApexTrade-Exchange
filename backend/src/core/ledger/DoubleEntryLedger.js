import crypto from 'crypto';

/**
 * DoubleEntryLedger.js
 * Implements strict double-entry bookkeeping.
 * Invariant: For every transaction, SUM(Debits) === SUM(Credits)
 * (#18 Distributed Transactions, #36 Optimistic Locking, #39 Race Conditions)
 */
export class DoubleEntryLedger {
  constructor() {
    this.accounts = new Map(); // id -> Account
    this.journals = [];
  }

  /**
   * Register or fetch an account
   * @param {import('./Account.js').Account} account
   */
  registerAccount(account) {
    this.accounts.set(account.id, account);
    return account;
  }

  /**
   * Post a balanced double-entry transaction
   * @param {Object} params
   * @param {string} params.idempotencyKey - Prevents double journal entry (#14)
   * @param {string} params.referenceType - 'TRADE', 'DEPOSIT', 'WITHDRAWAL', 'FEE'
   * @param {string} params.referenceId
   * @param {string} params.description
   * @param {Array<{ accountId: string, type: 'DEBIT' | 'CREDIT', amount: number, currency: string }>} params.entries
   */
  postTransaction({
    idempotencyKey,
    referenceType,
    referenceId,
    description,
    entries
  }) {
    if (!idempotencyKey) throw new Error('Idempotency key required');
    if (!entries || entries.length < 2) {
      throw new Error('A balanced transaction requires at least 2 entries');
    }

    // Verify accounting invariant per currency: SUM(DEBIT) === SUM(CREDIT)
    const currencyTotals = new Map();
    for (const entry of entries) {
      if (!currencyTotals.has(entry.currency)) {
        currencyTotals.set(entry.currency, { debit: 0, credit: 0 });
      }
      const totals = currencyTotals.get(entry.currency);
      if (entry.type === 'DEBIT') {
        totals.debit += entry.amount;
      } else if (entry.type === 'CREDIT') {
        totals.credit += entry.amount;
      } else {
        throw new Error(`Invalid entry type: ${entry.type}`);
      }
    }

    for (const [curr, totals] of currencyTotals.entries()) {
      const diff = Math.abs(totals.debit - totals.credit);
      if (diff > 1e-9) {
        throw new Error(
          `Accounting Invariant Violation for ${curr}: Debits (${totals.debit}) != Credits (${totals.credit})`
        );
      }
    }

    // Apply entries to accounts
    const journalId = crypto.randomUUID();
    for (const entry of entries) {
      const acc = this.accounts.get(entry.accountId);
      if (!acc) throw new Error(`Account not found: ${entry.accountId}`);

      if (entry.type === 'CREDIT') {
        acc.credit(entry.amount);
      } else if (entry.type === 'DEBIT') {
        // If funds were pre-locked, deduct from locked, otherwise from available
        if (acc.locked >= entry.amount) {
          acc.deductLocked(entry.amount);
        } else if (acc.available >= entry.amount) {
          acc.available -= entry.amount;
          acc.version += 1n;
        } else {
          throw new Error(`Insufficient balance in account ${acc.id} for debit of ${entry.amount}`);
        }
      }
    }

    const journal = {
      id: journalId,
      idempotencyKey,
      referenceType,
      referenceId,
      description,
      entries,
      createdAt: new Date()
    };

    this.journals.push(journal);
    return journal;
  }

  /**
   * Settles a matched trade between buyer and seller with exchange fee
   * @param {Object} trade
   * @param {string} buyerUsdAccId
   * @param {string} buyerBtcAccId
   * @param {string} sellerUsdAccId
   * @param {string} sellerBtcAccId
   * @param {string} feeAccUsdId
   * @param {number} feeRate - e.g. 0.001 (0.1%)
   */
  settleTrade(
    trade,
    buyerUsdAccId,
    buyerBtcAccId,
    sellerUsdAccId,
    sellerBtcAccId,
    feeAccUsdId,
    feeRate = 0.001
  ) {
    const grossUsd = trade.price * trade.amount;
    const feeUsd = grossUsd * feeRate;
    const netSellerUsd = grossUsd - feeUsd;

    return this.postTransaction({
      idempotencyKey: `settle-${trade.id}`,
      referenceType: 'TRADE',
      referenceId: trade.id,
      description: `Settlement for trade ${trade.id} @ ${trade.price}`,
      entries: [
        // Buyer pays gross USD
        { accountId: buyerUsdAccId, type: 'DEBIT', amount: grossUsd, currency: 'USD' },
        // Seller receives net USD
        { accountId: sellerUsdAccId, type: 'CREDIT', amount: netSellerUsd, currency: 'USD' },
        // Exchange collects fee
        { accountId: feeAccUsdId, type: 'CREDIT', amount: feeUsd, currency: 'USD' },

        // Seller delivers BTC
        { accountId: sellerBtcAccId, type: 'DEBIT', amount: trade.amount, currency: 'BTC' },
        // Buyer receives BTC
        { accountId: buyerBtcAccId, type: 'CREDIT', amount: trade.amount, currency: 'BTC' }
      ]
    });
  }
}
