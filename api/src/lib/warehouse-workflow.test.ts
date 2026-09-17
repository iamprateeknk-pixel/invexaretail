import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateFefo,
  allocateLots,
  parseTransferImport,
  validatePickInput,
  ManualAllocationRequiresReasonError,
  LotNotAllocatableError,
  ManualAllocationExceedsAvailableError,
} from './warehouse-workflow.js';

test('transfer import accepts minimal item name and quantity files', async () => {
  const preview = await parseTransferImport(Buffer.from('Item Name,Requested Qty,Remarks\nAlmond,12.5,Urgent\n'), 'transfer.csv');
  assert.equal(preview.validRows.length, 1);
  assert.equal(preview.validRows[0].requestedQty, 12.5);
});

test('FEFO allocation can fulfil one item from multiple lots', () => {
  const result = allocateFefo([
    { lotId: 'b', lotNo: 'B', expiryDate: '2026-11-15', available: 15 },
    { lotId: 'c', lotNo: 'C', expiryDate: '2027-01-20', available: 20 },
    { lotId: 'a', lotNo: 'A', expiryDate: '2026-10-10', available: 10 },
  ], 30);
  assert.deepEqual(result.allocations.map((row) => [row.lotNo, row.quantity]), [['A', 10], ['B', 15], ['C', 5]]);
  assert.equal(result.shortage, 0);
});

test('allocateFefo excludes expired, blocked and quarantined lots from allocation', () => {
  const result = allocateFefo([
    { lotId: 'exp', lotNo: 'EXP', expiryDate: '2026-01-01', available: 20, status: 'EXPIRED' },
    { lotId: 'blk', lotNo: 'BLK', expiryDate: '2026-02-01', available: 20, status: 'BLOCKED' },
    { lotId: 'qtn', lotNo: 'QTN', expiryDate: '2026-03-01', available: 20, status: 'QUARANTINE' },
    { lotId: 'ok', lotNo: 'OK', expiryDate: '2026-12-01', available: 20, status: 'AVAILABLE' },
  ], 15);
  assert.deepEqual(result.allocations.map((a) => a.lotNo), ['OK']);
  assert.equal(result.allocations[0].quantity, 15);
  assert.equal(result.shortage, 0);
});

test('allocateLots with FIFO strategy picks the oldest lot by createdAt regardless of expiry', () => {
  const result = allocateLots([
    { lotId: 'new', lotNo: 'NEW', createdAt: '2026-06-01', expiryDate: '2026-07-01', available: 10 },
    { lotId: 'old', lotNo: 'OLD', createdAt: '2026-01-01', expiryDate: '2027-01-01', available: 10 },
  ], 10, 'FIFO');
  assert.deepEqual(result.allocations.map((a) => a.lotNo), ['OLD']);
  assert.equal(result.strategy, 'FIFO');
});

test('allocateLots MANUAL override requires a reason', () => {
  const lots = [{ lotId: 'a', lotNo: 'A', available: 10, status: 'AVAILABLE' as const }];
  assert.throws(
    () => allocateLots(lots, 5, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 5 }] }),
    ManualAllocationRequiresReasonError,
  );
  assert.doesNotThrow(() =>
    allocateLots(lots, 5, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 5 }], overrideReason: 'Customer requested this batch' }),
  );
});

test('allocateLots MANUAL override cannot draw from a blocked or expired lot', () => {
  const lots = [{ lotId: 'a', lotNo: 'A', available: 10, status: 'BLOCKED' as const }];
  assert.throws(
    () => allocateLots(lots, 5, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 5 }], overrideReason: 'Testing' }),
    LotNotAllocatableError,
  );
});

test('allocateLots MANUAL override cannot exceed the lot\'s actual availability', () => {
  const lots = [{ lotId: 'a', lotNo: 'A', available: 10, status: 'AVAILABLE' as const }];
  assert.throws(
    () => allocateLots(lots, 50, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 50 }], overrideReason: 'Testing' }),
    ManualAllocationExceedsAvailableError,
  );
});

test('allocateLots reports shortage when even manual lines cannot cover the request', () => {
  const lots = [{ lotId: 'a', lotNo: 'A', available: 10, status: 'AVAILABLE' as const }];
  const result = allocateLots(lots, 30, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 10 }], overrideReason: 'Partial fulfilment approved' });
  assert.equal(result.shortage, 20);
});

test('PCS requires a matching scan and KG allows 3 decimal manual entry', () => {
  assert.throws(() => validatePickInput({ unit: 'PCS', quantity: 1, inputMethod: 'MANUAL', itemCode: 'DF001', lotNo: 'L1' }), /scan/i);
  assert.throws(() => validatePickInput({ unit: 'PCS', quantity: 1, inputMethod: 'SCAN', scanCode: 'OTHER', itemCode: 'DF001', lotNo: 'L1' }), /Wrong Item/);
  assert.doesNotThrow(() => validatePickInput({ unit: 'KG', quantity: 12.375, inputMethod: 'MANUAL', itemCode: 'DF001', lotNo: 'L1' }));
  assert.throws(() => validatePickInput({ unit: 'KG', quantity: 1.2345, inputMethod: 'MANUAL', itemCode: 'DF001', lotNo: 'L1' }), /3 decimal/);
});
