import test from 'node:test';
import assert from 'node:assert/strict';
import { Account } from './Account.js';
import { DoubleEntryLedger } from './DoubleEntryLedger.js';
import { DistributedLock } from '../locks/DistributedLock.js';
import { IdempotencyStore } from '../idempotency/IdempotencyStore.js';

test('Ledger: Enforces Zero-Sum Debit/Credit Invariant', () => {
  const ledger = new DoubleEntryLedger();
  const acc1 = ledger.registerAccount(new Account({
    id: 'acc-1',
    userId: 'alice',
    currency: 'USD',
    type: 'ASSET',
    initialBalance: 1000
  }));

  const acc2 = ledger.registerAccount(new Account({
    id: 'acc-2',
    userId: 'bob',
    currency: 'USD',
    type: 'LIABILITY',
    initialBalance: 0
  }));

  // Successful balanced transfer
  const journal = ledger.postTransaction({
    idempotencyKey: 'tx-1',
    referenceType: 'TRANSFER',
    referenceId: 'ref-1',
    description: 'Alice transfers to Bob',
    entries: [
      { accountId: 'acc-1', type: 'DEBIT', amount: 250, currency: 'USD' },
      { accountId: 'acc-2', type: 'CREDIT', amount: 250, currency: 'USD' }
    ]
  });

  assert.ok(journal);
  assert.equal(acc1.available, 750);
  assert.equal(acc2.available, 250);

  // Unbalanced transfer should fail
  assert.throws(() => {
    ledger.postTransaction({
      idempotencyKey: 'tx-invalid',
      referenceType: 'TRANSFER',
      referenceId: 'ref-invalid',
      description: 'Fraudulent unbalanced entry',
      entries: [
        { accountId: 'acc-1', type: 'DEBIT', amount: 500, currency: 'USD' },
        { accountId: 'acc-2', type: 'CREDIT', amount: 400, currency: 'USD' } // Mismatch!
      ]
    });
  }, /Accounting Invariant Violation/);
});

test('DistributedLock: Mutual Exclusion and Safe Release', async () => {
  const lockManager = new DistributedLock({ defaultTtlMs: 2000 });
  const resource = 'wallet:user-123';

  let sharedCounter = 0;
  const task = async () => {
    await lockManager.withLock(resource, async () => {
      const current = sharedCounter;
      await new Promise(r => setTimeout(r, 10)); // Simulate async DB delay
      sharedCounter = current + 1;
    });
  };

  // Run two concurrent tasks targeting the exact same wallet lock
  await Promise.all([task(), task()]);
  assert.equal(sharedCounter, 2); // No lost updates (#39 Race Conditions)
});

test('IdempotencyStore: Prevents Duplicate Operations and Returns Cached Response', () => {
  const store = new IdempotencyStore();
  const key = 'deposit-req-abc-123';

  // First request
  const first = store.start(key);
  assert.equal(first.proceed, true);

  // Simulating in-flight conflict
  assert.throws(() => {
    store.start(key);
  }, /ConcurrentRequestConflict/);

  // First resolves
  store.resolve(key, { status: 'SUCCESS', transactionId: 'tx-999' });

  // Retry returns cached response without re-processing
  const second = store.start(key);
  assert.equal(second.proceed, false);
  assert.deepEqual(second.cachedResponse, { status: 'SUCCESS', transactionId: 'tx-999' });
});
