import { DoubleEntryLedger, Account, DistributedLock } from '../models/index.js';
import { accountRepository } from '../core/db/AccountRepository.js';

class WalletLedgerService {
  constructor() {
    this.ledger = new DoubleEntryLedger();
    this.lockManager = new DistributedLock();
    this._seedDemoAccounts();
  }

  _seedDemoAccounts() {
    // Treasury Fee Vault Account
    this.ledger.registerAccount(new Account({
      id: 'acc-treasury-fee-usd',
      userId: 'system-treasury',
      currency: 'USD',
      type: 'EQUITY',
      initialBalance: 0
    }));

    // Demo Trader Wallets
    const users = ['trader-alice', 'trader-bob'];
    for (const u of users) {
      this.ledger.registerAccount(new Account({
        id: `acc-${u}-usd`,
        userId: u,
        currency: 'USD',
        type: 'ASSET',
        initialBalance: 150000 // $150,000 USD
      }));
      this.ledger.registerAccount(new Account({
        id: `acc-${u}-btc`,
        userId: u,
        currency: 'BTC',
        type: 'ASSET',
        initialBalance: 12.5 // 12.5 BTC
      }));
      this.ledger.registerAccount(new Account({
        id: `acc-${u}-eth`,
        userId: u,
        currency: 'ETH',
        type: 'ASSET',
        initialBalance: 50.0 // 50.0 ETH
      }));
    }
  }

  getUserWallets(userId) {
    // 1. Try SQLite persistent store first (#33 Event Sourcing / WAL)
    try {
      let accounts = accountRepository.findByUser(userId);
      if (!accounts || accounts.length === 0) {
        // Auto-provision demo accounts in SQLite
        const defaults = [
          { cur: 'USD', bal: 150000 },
          { cur: 'BTC', bal: 12.5 },
          { cur: 'ETH', bal: 50.0 },
          { cur: 'SOL', bal: 200.0 }
        ];
        for (const { cur, bal } of defaults) {
          accountRepository.upsertAccount({
            id: `acc-${userId}-${cur.toLowerCase()}`,
            userId,
            currency: cur,
            type: 'ASSET',
            initialBalance: bal
          });
        }
        accounts = accountRepository.findByUser(userId);
      }

      if (accounts && accounts.length > 0) {
        return accounts.map(acc => ({
          accountId: acc.id,
          currency: acc.currency,
          available: Number(acc.available),
          locked: Number(acc.locked),
          total: Number(acc.available) + Number(acc.locked),
          version: String(acc.version)
        }));
      }
    } catch (err) {
      console.warn('[WalletLedgerService] SQLite fallback to in-memory ledger:', err.message);
    }

    // Fallback to in-memory ledger
    const wallets = [];
    for (const [id, acc] of this.ledger.accounts.entries()) {
      if (acc.userId === userId) {
        wallets.push({
          accountId: acc.id,
          currency: acc.currency,
          available: acc.available,
          locked: acc.locked,
          total: acc.available + acc.locked,
          version: acc.version.toString()
        });
      }
    }
    return wallets;
  }

  async executeUnderLock(userId, fn) {
    return this.lockManager.withLock(`wallet-lock:${userId}`, fn);
  }

  getJournalsCount() {
    return this.ledger.journals.length;
  }
}

export const walletLedgerService = new WalletLedgerService();
