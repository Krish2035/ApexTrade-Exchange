/**
 * PaymentRailService.js
 * Production deposit/withdrawal rails:
 *   1. Stripe (card / bank debit) — webhook-driven settlement
 *   2. Blockchain (BTC/ETH) — block confirmation watcher
 *   3. Bank Wire (SWIFT/ACH) — async settlement simulation
 *
 * (#15 Message Queues, #16 Pub/Sub, #17 Event-Driven, #18 Distributed Tx,
 *  #19 Saga Pattern, #20 DLQ, #13 Exponential Backoff)
 */
import crypto from 'crypto';
import { transactionRepository } from '../db/TransactionRepository.js';
import { accountRepository } from '../db/AccountRepository.js';
import { kycService } from '../kyc/KYCService.js';
import db from '../db/database.js';

// ─── Fee schedule ────────────────────────────────────────────────────────────
const FEES = {
  STRIPE_DEPOSIT:      0.015,   // 1.5%
  STRIPE_WITHDRAWAL:   0.01,    // 1.0%
  BLOCKCHAIN_BTC_DEP:  0.0005,  // 0.0005 BTC flat fee equivalent
  BLOCKCHAIN_ETH_DEP:  0.001,   // 0.001 ETH
  WIRE_WITHDRAWAL:     25,      // $25 flat
  INTERNAL:            0,
};

// Simulated blockchain "mempool" for confirmation watcher
const pendingBlockchainTx = new Map();

export class PaymentRailService {
  constructor() {
    // Start blockchain confirmation watcher (polls every 15s)
    this._startBlockchainConfirmationWatcher();
    // Purge old idempotency keys every hour
    setInterval(() => this._purgeIdempotencyKeys(), 3600_000);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. STRIPE DEPOSIT (card / bank debit)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initiate a Stripe payment intent for deposit
   * In production: call Stripe API, return client_secret to frontend
   */
  async initiateStripeDeposit(userId, { amount, currency = 'USD' }) {
    // AML check
    const aml = kycService.scoreTransaction(userId, { amount, currency, txType: 'DEPOSIT', rail: 'STRIPE' });
    if (aml.action === 'BLOCK') throw new Error(`Transaction blocked by AML system. Score: ${aml.score}`);

    const fee       = parseFloat((amount * FEES.STRIPE_DEPOSIT).toFixed(2));
    const netAmount = parseFloat((amount - fee).toFixed(2));
    // Simulated Stripe Payment Intent ID
    const stripePiId = `pi_${crypto.randomBytes(12).toString('hex')}`;

    const tx = transactionRepository.create({
      userId, type: 'DEPOSIT', currency, amount, fee, rail: 'STRIPE',
      externalRef: stripePiId, amlScore: aml.score
    });
    transactionRepository.updateStatus(tx.id, 'CONFIRMING', { stripePiId });

    // Simulate Stripe webhook arriving in 3 seconds
    setTimeout(() => this._handleStripeWebhook(tx.id, stripePiId, netAmount, userId, currency), 3000);

    return {
      transactionId: tx.id,
      stripePiId,
      amount,
      fee,
      netAmount,
      currency,
      status: 'CONFIRMING',
      clientSecret: `${stripePiId}_secret_${crypto.randomBytes(8).toString('hex')}`
    };
  }

  async _handleStripeWebhook(txId, piId, netAmount, userId, currency) {
    const accountId = `acc-${userId}-${currency.toLowerCase()}`;
    const account   = accountRepository.findById(accountId);
    if (!account) return;

    // Atomic: credit account + update transaction status
    const settleTx = db.transaction(() => {
      accountRepository.credit(accountId, netAmount);
      transactionRepository.updateStatus(txId, 'COMPLETED', { stripePiId: piId });
      try {
        accountRepository.recordJournal?.({
          type: 'DEPOSIT_STRIPE', debitAccountId: 'acc-treasury-fee-usd',
          creditAccountId: accountId, amount: netAmount, currency,
          referenceId: txId, referenceType: 'STRIPE_DEPOSIT'
        });
      } catch (err) {
        console.warn('[PaymentRail] Journal entry warning:', err.message);
      }
    });
    settleTx();
    console.log(`[PaymentRail] Stripe deposit settled: ${netAmount} ${currency} → ${userId}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. STRIPE WITHDRAWAL
  // ──────────────────────────────────────────────────────────────────────────

  async initiateStripeWithdrawal(userId, { amount, currency = 'USD', bankAccountId }) {
    const aml = kycService.scoreTransaction(userId, { amount, currency, txType: 'WITHDRAWAL', rail: 'STRIPE' });
    if (aml.action === 'BLOCK') throw new Error(`Withdrawal blocked by AML. Score: ${aml.score}`);

    const fee       = parseFloat((amount * FEES.STRIPE_WITHDRAWAL).toFixed(2));
    const netAmount = parseFloat((amount - fee).toFixed(2));
    const accountId = `acc-${userId}-${currency.toLowerCase()}`;

    // Lock funds
    const lockAndCreate = db.transaction(() => {
      accountRepository.lockFunds(accountId, amount);
      return transactionRepository.create({
        userId, type: 'WITHDRAWAL', currency, amount, fee, rail: 'STRIPE',
        externalRef: bankAccountId, amlScore: aml.score
      });
    });
    const tx = lockAndCreate();

    // Simulate payout processing (5 seconds)
    setTimeout(() => this._settleWithdrawal(tx.id, accountId, amount, currency, { type: 'STRIPE' }), 5000);

    return { transactionId: tx.id, amount, fee, netAmount, currency, status: 'PROCESSING' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. BLOCKCHAIN DEPOSIT WATCHER
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Register a new blockchain deposit address for monitoring
   */
  generateDepositAddress(userId, currency) {
    // In production: derive from HD wallet (BIP-44 path)
    const address = currency === 'BTC'
      ? `1Apex${crypto.randomBytes(16).toString('hex').slice(0, 24)}`
      : `0x${crypto.randomBytes(20).toString('hex')}`;

    return { address, currency, userId, expires: new Date(Date.now() + 24 * 3600_000).toISOString() };
  }

  generateCryptoDepositAddress(userId, currency) {
    return this.generateDepositAddress(userId, currency);
  }

  simulateCryptoDeposit(userId, opts) {
    return this.simulateBlockchainDeposit(userId, opts);
  }

  /**
   * Simulate incoming blockchain deposit (in production: listen to node RPC/websocket)
   */
  simulateBlockchainDeposit(userId, { amount, currency, fromAddress }) {
    const aml = kycService.scoreTransaction(userId, { amount, currency, txType: 'DEPOSIT', rail: 'BLOCKCHAIN', address: fromAddress });
    if (aml.action === 'BLOCK') throw new Error(`Blockchain deposit blocked by AML. Score: ${aml.score}`);

    const blockchainHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const fee = currency === 'BTC' ? FEES.BLOCKCHAIN_BTC_DEP : FEES.BLOCKCHAIN_ETH_DEP;
    const netAmount = parseFloat((amount - fee).toFixed(8));

    const tx = transactionRepository.create({
      userId, type: 'DEPOSIT', currency, amount, fee, rail: 'BLOCKCHAIN',
      externalRef: fromAddress, address: fromAddress, amlScore: aml.score
    });
    transactionRepository.updateStatus(tx.id, 'CONFIRMING', { blockchainHash, confirmations: 0 });

    // Register in watcher
    pendingBlockchainTx.set(blockchainHash, {
      txId: tx.id, userId, currency, netAmount, accountId: `acc-${userId}-${currency.toLowerCase()}`,
      confirmations: 0, requiredConfirmations: currency === 'BTC' ? 3 : 12
    });

    console.log(`[BlockchainWatcher] Monitoring tx ${blockchainHash} for ${userId}`);
    return { transactionId: tx.id, blockchainHash, amount, fee, netAmount, currency, status: 'CONFIRMING', confirmations: 0, requiredConfirmations: currency === 'BTC' ? 3 : 12 };
  }

  _startBlockchainConfirmationWatcher() {
    setInterval(() => {
      for (const [hash, info] of pendingBlockchainTx) {
        info.confirmations++;
        transactionRepository.updateStatus(info.txId, 'CONFIRMING', { confirmations: info.confirmations, blockchainHash: hash });

        if (info.confirmations >= info.requiredConfirmations) {
          // Settle
          const settle = db.transaction(() => {
            accountRepository.credit(info.accountId, info.netAmount);
            transactionRepository.updateStatus(info.txId, 'COMPLETED', { confirmations: info.confirmations });
          });
          settle();
          pendingBlockchainTx.delete(hash);
          console.log(`[BlockchainWatcher] Confirmed: ${info.netAmount} ${info.currency} → ${info.userId} after ${info.confirmations} blocks`);
        }
      }
    }, 15_000); // 15s = 1 simulated block
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. BANK WIRE WITHDRAWAL (SWIFT / ACH)
  // ──────────────────────────────────────────────────────────────────────────

  async initiateWireWithdrawal(userId, { amount, currency = 'USD', bankDetails }) {
    const aml = kycService.scoreTransaction(userId, { amount, currency, txType: 'WITHDRAWAL', rail: 'WIRE' });
    if (aml.action === 'BLOCK') throw new Error(`Wire transfer blocked by AML. Score: ${aml.score}`);

    const fee = FEES.WIRE_WITHDRAWAL;
    const accountId = `acc-${userId}-${currency.toLowerCase()}`;

    const lockAndCreate = db.transaction(() => {
      accountRepository.lockFunds(accountId, amount + fee);
      return transactionRepository.create({
        userId, type: 'WITHDRAWAL', currency, amount, fee, rail: 'WIRE',
        externalRef: bankDetails?.accountNumber, amlScore: aml.score
      });
    });
    const tx = lockAndCreate();

    // Wire takes 1-3 business days; simulate as 10 seconds
    setTimeout(() => this._settleWithdrawal(tx.id, accountId, amount + fee, currency, { type: 'WIRE', bankRef: `WIRE-${Date.now()}` }), 10_000);

    return { transactionId: tx.id, amount, fee, netAmount: amount - fee, currency, status: 'PROCESSING', eta: '1-3 business days' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SHARED: Withdrawal Settlement (exponential backoff retry)
  // ──────────────────────────────────────────────────────────────────────────

  async _settleWithdrawal(txId, accountId, lockedAmount, currency, meta = {}, attempt = 1) {
    const MAX_ATTEMPTS = 5;
    try {
      const settle = db.transaction(() => {
        accountRepository.debitLocked(accountId, lockedAmount);
        transactionRepository.updateStatus(txId, 'COMPLETED', meta);
      });
      settle();
      console.log(`[PaymentRail] Withdrawal settled: ${txId}`);
    } catch (err) {
      console.error(`[PaymentRail] Settlement attempt ${attempt} failed for ${txId}: ${err.message}`);
      if (attempt >= MAX_ATTEMPTS) {
        // Release funds back (compensating transaction)
        accountRepository.releaseFunds(accountId, lockedAmount);
        transactionRepository.updateStatus(txId, 'FAILED');
        console.error(`[PaymentRail] Max retries exceeded for ${txId}. Funds released.`);
        return;
      }
      // Exponential backoff (#13)
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
      setTimeout(() => this._settleWithdrawal(txId, accountId, lockedAmount, currency, meta, attempt + 1), delay);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // History & Status
  // ──────────────────────────────────────────────────────────────────────────

  getTransactionHistory(userId, opts) {
    return transactionRepository.findByUser(userId, opts);
  }

  getTransactionById(txId) {
    return transactionRepository.findById(txId);
  }

  _purgeIdempotencyKeys() {
    db.prepare(`DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-24 hours')`).run();
  }
}

export const paymentRailService = new PaymentRailService();
