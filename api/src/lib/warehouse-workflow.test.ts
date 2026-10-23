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
  lotRemainingShelfLifePercent,
} from './warehouse-workflow.js';

test('transfer import accepts minimal item name and quantity files', async () => {
  const preview = await parseTransferImport(Buffer.from('Item Name,Requested Qty,Remarks\nAlmond,12.5,Urgent\n'), 'transfer.csv');
  assert.equal(preview.validRows.length, 1);
  assert.equal(preview.validRows[0].requestedQty, 12.5);
});

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test('FEFO allocation can fulfil one item from multiple lots', () => {
  // Relative dates: fixed calendar dates silently become "expired" (and excluded) once they pass.
  const result = allocateFefo([
    { lotId: 'b', lotNo: 'B', expiryDate: daysFromNow(60), available: 15 },
    { lotId: 'c', lotNo: 'C', expiryDate: daysFromNow(120), available: 20 },
    { lotId: 'a', lotNo: 'A', expiryDate: daysFromNow(30), available: 10 },
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

// Audit P0-1: nothing sweeps a lot to EXPIRED when its date passes, and FEFO sorts
// the earliest expiry first - so a lapsed lot still marked AVAILABLE used to be the
// FIRST lot allocated to orders, jobs and transfers.
const auditToday = new Date('2026-09-26T06:30:00Z');
test('FEFO never allocates a lot whose expiry date has passed, even if its status still says AVAILABLE', () => {
  const lots = [
    { lotId: 'lapsed', lotNo: 'L0', expiryDate: '2026-09-20T00:00:00.000Z', available: 10, status: 'AVAILABLE' as const },
    { lotId: 'fresh', lotNo: 'L1', expiryDate: '2026-12-01T00:00:00.000Z', available: 10, status: 'AVAILABLE' as const },
  ];
  const result = allocateLots(lots, 5, 'FEFO', { today: auditToday });
  assert.deepEqual(result.allocations.map((a) => a.lotId), ['fresh']);
  assert.deepEqual(allocateFefo(lots, 5, auditToday).allocations.map((a) => a.lotId), ['fresh']);
  assert.deepEqual(allocateLots(lots, 5, 'FIFO', { today: auditToday }).allocations.map((a) => a.lotId), ['fresh']);
});

test('a lot expiring today is still allocatable today (usable through its expiry date); the day after it is not', () => {
  const lots = [{ lotId: 'a', lotNo: 'L', expiryDate: '2026-09-26T00:00:00.000Z', available: 4, status: 'AVAILABLE' as const }];
  assert.equal(allocateLots(lots, 4, 'FEFO', { today: auditToday }).shortage, 0);
  assert.equal(allocateLots(lots, 4, 'FEFO', { today: new Date('2026-09-27T06:30:00Z') }).shortage, 4);
});

test('when only lapsed lots exist the request is a shortage, and a manual override cannot pull a lapsed lot', () => {
  const lots = [{ lotId: 'a', lotNo: 'L', expiryDate: '2026-09-01T00:00:00.000Z', available: 9, status: 'AVAILABLE' as const }];
  assert.equal(allocateLots(lots, 3, 'FEFO', { today: auditToday }).shortage, 3);
  assert.throws(
    () => allocateLots(lots, 3, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 3 }], overrideReason: 'Needed', today: auditToday }),
    /cannot be allocated/,
  );
});

test('a customer minimum remaining shelf life skips lots below it; unknown-RSL lots still pass (audit S-1)', () => {
  const today = new Date('2026-09-26T06:00:00Z');
  const day = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString();
  const lots = [
    { lotId: 'old', lotNo: 'OLD', available: 50, expiryDate: day(10), shelfLifeDays: 100 },
    { lotId: 'fresh', lotNo: 'FRESH', available: 50, expiryDate: day(80), shelfLifeDays: 100 },
    { lotId: 'nodate', lotNo: 'ND', available: 50, expiryDate: null },
  ];
  assert.equal(lotRemainingShelfLifePercent(lots[1], today), 80);
  const strict = allocateLots(lots, 30, 'FEFO', { today, minRemainingShelfLifePercent: 50 });
  assert.deepEqual(strict.allocations.map((a) => a.lotId), ['fresh']);
  assert.equal(allocateLots(lots, 30, 'FEFO', { today }).allocations[0].lotId, 'old', 'no requirement: plain FEFO');
  // Life derived from the manufacturing date when the item has no shelf life: 100 days, 10 left = 10%.
  const made = { lotId: 'm', lotNo: 'M', available: 5, manufacturedAt: day(-90), expiryDate: day(10) };
  assert.equal(Math.round(lotRemainingShelfLifePercent(made, today)!), 10);
});
