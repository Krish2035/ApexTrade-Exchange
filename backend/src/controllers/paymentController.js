/**
 * paymentController.js
 * Controller for deposit and withdrawal rails:
 * - Stripe card / ACH deposits & webhooks
 * - Blockchain BTC/ETH deposits & withdrawals with confirmation watcher
 * - Wire transfers
 * - Transaction audit history
 *
 * (#15 Message Queues, #18 Distributed Tx, #19 Saga, #20 DLQ, #72 Encryption)
 */
import { paymentRailService } from '../core/payments/PaymentRailService.js';

export class PaymentController {
  // ─── Stripe Rails ─────────────────────────────────────────────────────────

  static async initiateStripeDeposit(req, res, next) {
    try {
      const userId = req.user?.sub || req.body.userId || 'trader-alice';
      const { amount, currency = 'USD' } = req.body;

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Valid positive deposit amount is required' });
      }

      const result = await paymentRailService.initiateStripeDeposit(userId, {
        amount: Number(amount),
        currency
      });

      return res.status(200).json({
        success: true,
        message: 'Stripe deposit session initialized',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  static async handleStripeWebhook(req, res, next) {
    try {
      const event = req.body;
      const result = await paymentRailService.handleStripeWebhook(event);
      return res.json({ received: true, ...result });
    } catch (err) {
      next(err);
    }
  }

  // ─── Crypto Rails ─────────────────────────────────────────────────────────

  static getCryptoDepositAddress(req, res, next) {
    try {
      const userId = req.user?.sub || req.params.userId || 'trader-alice';
      const currency = req.params.currency || req.query.currency || 'BTC';
      const result = paymentRailService.generateCryptoDepositAddress(userId, currency);
      return res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }

  static async simulateCryptoDeposit(req, res, next) {
    try {
      const userId = req.user?.sub || req.body.userId || 'trader-alice';
      const { currency = 'BTC', amount, txHash } = req.body;

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Valid crypto deposit amount is required' });
      }

      const result = await paymentRailService.simulateCryptoDeposit(userId, {
        currency,
        amount: Number(amount),
        txHash
      });

      return res.status(202).json({
        success: true,
        message: 'Crypto deposit detected in mempool. Confirmations accumulating.',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  static async requestCryptoWithdrawal(req, res, next) {
    try {
      const userId = req.user?.sub || req.body.userId || 'trader-alice';
      const { currency, amount, toAddress, twoFactorCode } = req.body;

      if (!currency || !amount || !toAddress) {
        return res.status(400).json({ error: 'currency, amount, and toAddress are required' });
      }

      const result = await paymentRailService.requestCryptoWithdrawal(userId, {
        currency,
        amount: Number(amount),
        toAddress,
        twoFactorCode
      });

      return res.status(200).json({
        success: true,
        message: 'Crypto withdrawal submitted for on-chain broadcast',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Bank Wire Rails ──────────────────────────────────────────────────────

  static async requestWireWithdrawal(req, res, next) {
    try {
      const userId = req.user?.sub || req.body.userId || 'trader-alice';
      const { amount, bankDetails } = req.body;

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Valid withdrawal amount required' });
      }

      const result = await paymentRailService.requestWireWithdrawal(userId, {
        amount: Number(amount),
        bankDetails
      });

      return res.status(200).json({
        success: true,
        message: 'Bank wire withdrawal queued for Fedwire/SWIFT batch',
        ...result
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Transaction History ──────────────────────────────────────────────────

  static getHistory(req, res, next) {
    try {
      const userId = req.user?.sub || req.params.userId || 'trader-alice';
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const history = paymentRailService.getTransactionHistory(userId, { limit, offset });
      return res.json({ success: true, userId, transactions: history });
    } catch (err) {
      next(err);
    }
  }

  static getTransaction(req, res, next) {
    try {
      const { txId } = req.params;
      const tx = paymentRailService.getTransactionById(txId);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      return res.json({ success: true, transaction: tx });
    } catch (err) {
      next(err);
    }
  }
}
