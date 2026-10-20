import { DoubleEntryLedger, Account, DistributedLock } from '../models/index.js';

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
