import { sagaCoordinator } from '../core/saga/SagaCoordinator.js';

export class SagaController {
  static async withdraw(req, res, next) {
    try {
      const { amount, currency = 'USD', destinationAddress = 'US-BANK-882910', simulateFailure = false } = req.body;
      const userId = req.user ? req.user.sub : (req.body.userId || 'trader-alice');

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid positive amount required' });
      }

      const saga = await sagaCoordinator.executeWithdrawalSaga({
        userId,
        amount: Number(amount),
        currency,
        destinationAddress,
        simulateFailure: Boolean(simulateFailure)
      });

      const statusCode = saga.status === 'SUCCESS' ? 200 : 422;
      return res.status(statusCode).json({
        success: saga.status === 'SUCCESS',
        saga
      });
    } catch (err) {
      next(err);
    }
  }

  static async deposit(req, res, next) {
    try {
      const { amount, currency = 'USD', externalTxId = `tx-ext-${Date.now()}` } = req.body;
      const userId = req.user ? req.user.sub : (req.body.userId || 'trader-alice');

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid positive amount required' });
      }

      const saga = await sagaCoordinator.executeDepositSaga({
        userId,
        amount: Number(amount),
        currency,
        externalTxId
      });

      return res.status(200).json({
        success: true,
        saga
      });
    } catch (err) {
      next(err);
    }
  }

  static getSaga(req, res) {
    const saga = sagaCoordinator.getSaga(req.params.sagaId);
    if (!saga) return res.status(404).json({ error: 'Saga not found' });
    return res.json({ saga });
  }

  static getDLQ(req, res) {
    const dlq = sagaCoordinator.getDLQ();
    return res.json({
      dlqCount: dlq.length,
      dlq
    });
  }
}
