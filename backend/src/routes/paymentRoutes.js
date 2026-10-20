import { Router } from 'express';
import { PaymentController } from '../controllers/paymentController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = Router();

// Stripe deposit routes
router.post('/stripe/initiate', authenticate(false), PaymentController.initiateStripeDeposit);
router.post('/stripe/webhook', PaymentController.handleStripeWebhook);

// Crypto rails
router.get('/crypto/address', authenticate(false), PaymentController.getCryptoDepositAddress);
router.get('/crypto/address/:currency', authenticate(false), PaymentController.getCryptoDepositAddress);
router.post('/crypto/deposit', authenticate(false), PaymentController.simulateCryptoDeposit);
router.post('/crypto/withdraw', authenticate(false), PaymentController.requestCryptoWithdrawal);

// Bank Wire rails
router.post('/wire/withdraw', authenticate(false), PaymentController.requestWireWithdrawal);

// History
router.get('/history', authenticate(false), PaymentController.getHistory);
router.get('/history/:userId', authenticate(false), PaymentController.getHistory);
router.get('/transaction/:txId', PaymentController.getTransaction);

export default router;
