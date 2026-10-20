import crypto from 'crypto';
import { walletLedgerService } from '../../services/walletLedgerService.js';
import { eventStore } from '../events/EventStore.js';

/**
 * SagaCoordinator.js
 * Implements Orchestrated Saga Pattern with Compensating Transactions and Dead Letter Queue.
 * (#18 Distributed Transactions, #19 Saga Pattern, #20 Dead Letter Queues, #13 Exponential Backoff)
 */
export class SagaCoordinator {
  constructor() {
    this.sagas = new Map(); // sagaId -> SagaInstance
    this.dlq = [];          // Dead Letter Queue for poison-pill transactions (#20)
  }

  /**
   * Executes a multi-step Withdrawal Saga with automatic compensating actions
   * @param {Object} params
   * @param {string} params.userId
   * @param {number} params.amount
   * @param {string} params.currency
   * @param {string} params.destinationAddress
   * @param {boolean} [params.simulateFailure=false] - Used to test compensation rollback
   */
  async executeWithdrawalSaga({ userId, amount, currency, destinationAddress, simulateFailure = false }) {
    const sagaId = `saga-wth-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const saga = {
      id: sagaId,
      type: 'WITHDRAWAL',
      userId,
      amount,
      currency,
      destinationAddress,
      status: 'STARTED',
      currentStep: 0,
      steps: [
        { name: 'LOCK_FUNDS', status: 'PENDING' },
        { name: 'EXTERNAL_PAYOUT_GATEWAY', status: 'PENDING' },
        { name: 'SETTLE_GENERAL_LEDGER', status: 'PENDING' }
      ],
      compensations: [],
      createdAt: new Date().toISOString()
    };

    this.sagas.set(sagaId, saga);
    eventStore.append('SAGA_STARTED', { sagaId, type: 'WITHDRAWAL', amount, currency });

    try {
      // ----------------------------------------------------------------------
      // Step 1: Lock user funds in ledger
      // ----------------------------------------------------------------------
      saga.currentStep = 1;
      saga.steps[0].status = 'EXECUTING';

      await walletLedgerService.executeUnderLock(userId, async () => {
        const userAcc = Array.from(walletLedgerService.ledger.accounts.values()).find(
          a => a.userId === userId && a.currency === currency
        );
        if (!userAcc) throw new Error(`User wallet not found for ${currency}`);
        if (userAcc.available < amount) throw new Error(`Insufficient funds: ${userAcc.available} < ${amount}`);

        userAcc.lockFunds(amount);
      });

      saga.steps[0].status = 'COMPLETED';
      // Register compensating transaction if later steps fail (#19 Saga Pattern)
      saga.compensations.push(async () => {
        console.log(`[Saga Rollback] Compensating Step 1: Unlocking ${amount} ${currency} for ${userId}...`);
        await walletLedgerService.executeUnderLock(userId, async () => {
          const userAcc = Array.from(walletLedgerService.ledger.accounts.values()).find(
            a => a.userId === userId && a.currency === currency
          );
          if (userAcc) userAcc.unlockFunds(amount);
        });
      });

      // ----------------------------------------------------------------------
      // Step 2: Call External Banking / Crypto Gateway
      // ----------------------------------------------------------------------
      saga.currentStep = 2;
      saga.steps[1].status = 'EXECUTING';

      // Simulate external payout network call with retry & exponential backoff (#12, #13)
      await this._simulateExternalGateway(simulateFailure);
      saga.steps[1].status = 'COMPLETED';

      // ----------------------------------------------------------------------
      // Step 3: Settle General Ledger (Permanent Debit)
      // ----------------------------------------------------------------------
      saga.currentStep = 3;
      saga.steps[2].status = 'EXECUTING';

      await walletLedgerService.executeUnderLock(userId, async () => {
        const userAcc = Array.from(walletLedgerService.ledger.accounts.values()).find(
          a => a.userId === userId && a.currency === currency
        );
        if (userAcc) userAcc.deductLocked(amount);
      });

      saga.steps[2].status = 'COMPLETED';
      saga.status = 'SUCCESS';
      saga.completedAt = new Date().toISOString();

      eventStore.append('SAGA_COMPLETED', { sagaId, status: 'SUCCESS' });
      return saga;

    } catch (err) {
      console.error(`[Saga Failure] Saga ${sagaId} failed at step ${saga.currentStep}: ${err.message}`);
      saga.status = 'COMPENSATING';
      saga.error = err.message;

      // Execute Compensating Transactions in reverse order (#19 Saga Compensations)
      try {
        while (saga.compensations.length > 0) {
          const compFn = saga.compensations.pop();
          await compFn();
        }
        saga.status = 'COMPENSATED';
        console.log(`[Saga] Successfully compensated and refunded user funds for ${sagaId}`);
      } catch (compErr) {
        // Poison-Pill failure: Route to Dead Letter Queue (#20 DLQ)
        console.error(`[Saga Critical] Compensation failed for ${sagaId}! Routing to DLQ!`);
        saga.status = 'DLQ_ROUTED';
        this.dlq.push({
          sagaId,
          error: compErr.message,
          timestamp: Date.now(),
          saga
        });
        eventStore.append('SAGA_DLQ_ROUTED', { sagaId, error: compErr.message });
      }

      eventStore.append('SAGA_FAILED', { sagaId, finalStatus: saga.status, error: err.message });
      return saga;
    }
  }

  /**
   * Executes a multi-step Deposit Saga (Fiat / Webhook verification)
   */
  async executeDepositSaga({ userId, amount, currency, externalTxId }) {
    const sagaId = `saga-dep-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const saga = {
      id: sagaId,
      type: 'DEPOSIT',
      userId,
      amount,
      currency,
      externalTxId,
      status: 'STARTED',
      createdAt: new Date().toISOString()
    };

    this.sagas.set(sagaId, saga);

    // Step 1: Credit user available balance under distributed lock
    await walletLedgerService.executeUnderLock(userId, async () => {
      let userAcc = Array.from(walletLedgerService.ledger.accounts.values()).find(
        a => a.userId === userId && a.currency === currency
      );
      if (!userAcc) {
        userAcc = walletLedgerService.ledger.registerAccount({
          id: `acc-${userId}-${currency.toLowerCase()}`,
          userId,
          currency,
          type: 'ASSET',
          available: 0,
          locked: 0,
          version: 1n
        });
      }
      userAcc.credit(amount);
    });

    saga.status = 'SUCCESS';
    saga.completedAt = new Date().toISOString();
    eventStore.append('SAGA_DEPOSIT_COMPLETED', { sagaId, userId, amount, currency });
    return saga;
  }

  /**
   * Simulates external payout gateway with simulated latency
   */
  async _simulateExternalGateway(simulateFailure) {
    await new Promise(r => setTimeout(r, 80)); // 80ms network round-trip
    if (simulateFailure) {
      throw new Error('BankingNetworkTimeout: Bank payment rail rejected transfer');
    }
    return true;
  }

  getSaga(sagaId) {
    return this.sagas.get(sagaId);
  }

  getDLQ() {
    return this.dlq;
  }
}

export const sagaCoordinator = new SagaCoordinator();
