import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildControlCenter,
  classifyImportError,
  dayWindow,
  summarizeRowCounters,
  todayFor,
  type MovementActivity,
} from './import-control-center.js';
import { syncCheckpoints, upsertSyncCheckpoint } from './repository.js';

const locations = [
  { id: 'loc-1', name: 'Main Store', type: 'store' as const },
  { id: 'loc-2', name: 'Second Store', type: 'store' as const },
  { id: 'wh-1', name: 'HO Basni', type: 'warehouse' as const },
];

const activity = (over: Partial<MovementActivity> & { locationId: string; sourceType: 'SALES' | 'PURCHASE' }): MovementActivity => ({
  count: 5, lastTransactionAt: '2026-09-18T12:00:00.000Z', batchIds: ['b1'], ...over,
});

const noRejections = { rejectedByLocation: new Map(), unattributedRejected: { sales: 0, purchases: 0 } };

test('a business day is bounded in the branch timezone, not UTC', () => {
  // India is UTC+5:30, so 18 Sep local runs 17 Sep 18:30Z to 18 Sep 18:30Z.
  assert.deepEqual(dayWindow('2026-09-18', 'Asia/Kolkata'), { from: '2026-09-17T18:30:00.000Z', to: '2026-09-18T18:30:00.000Z' });
  assert.deepEqual(dayWindow('2026-09-18', 'UTC'), { from: '2026-09-18T00:00:00.000Z', to: '2026-09-19T00:00:00.000Z' });
  assert.equal(todayFor('Asia/Kolkata', new Date('2026-09-18T20:00:00Z')), '2026-09-19');
});

test('every store is expected to report sales; a store with none is MISSING', () => {
  const report = buildControlCenter({
    date: '2026-09-18', timezone: 'Asia/Kolkata', locations,
    activity: [activity({ locationId: 'loc-1', sourceType: 'SALES' })], ...noRejections,
  });
  assert.equal(report.sales.status, 'PARTIAL');
  assert.deepEqual(report.sales.branches.map((row) => [row.locationName, row.status]), [['Main Store', 'UPLOADED'], ['Second Store', 'MISSING']]);
  // Warehouses are not expected to report sales.
  assert.equal(report.sales.branches.some((row) => row.locationId === 'wh-1'), false);
  assert.equal(report.purchases.status, 'MISSING');

  const all = buildControlCenter({
    date: '2026-09-18', timezone: 'Asia/Kolkata', locations,
    activity: [activity({ locationId: 'loc-1', sourceType: 'SALES' }), activity({ locationId: 'loc-2', sourceType: 'SALES', batchIds: ['b2'] })], ...noRejections,
  });
  assert.equal(all.sales.status, 'UPLOADED');
  assert.deepEqual(all.sales.batchIds.sort(), ['b1', 'b2']);

  const none = buildControlCenter({ date: '2026-09-18', timezone: 'UTC', locations, activity: [], ...noRejections });
  assert.equal(none.sales.status, 'MISSING');
});

test('purchases are only listed where they happened; rejected rows make a day PARTIAL', () => {
  const report = buildControlCenter({
    date: '2026-09-18', timezone: 'UTC', locations,
    activity: [activity({ locationId: 'wh-1', sourceType: 'PURCHASE', count: 12 }), activity({ locationId: 'loc-1', sourceType: 'SALES' }), activity({ locationId: 'loc-2', sourceType: 'SALES' })],
    rejectedByLocation: new Map([['loc-2', { sales: 3, purchases: 0 }]]),
    unattributedRejected: { sales: 0, purchases: 0 },
  });
  assert.equal(report.purchases.status, 'UPLOADED');
  assert.deepEqual(report.purchases.branches.map((row) => row.locationName), ['HO Basni']);
  const second = report.sales.branches.find((row) => row.locationId === 'loc-2')!;
  assert.deepEqual([second.status, second.rejectedRows], ['PARTIAL', 3]);
  assert.equal(report.sales.status, 'PARTIAL');

  // Rows rejected for an unknown branch cannot be attributed but still keep the day from looking clean.
  const unattributed = buildControlCenter({
    date: '2026-09-18', timezone: 'UTC', locations,
    activity: [activity({ locationId: 'loc-1', sourceType: 'SALES' }), activity({ locationId: 'loc-2', sourceType: 'SALES' })],
    rejectedByLocation: new Map(), unattributedRejected: { sales: 2, purchases: 0 },
  });
  assert.equal(unattributed.sales.status, 'PARTIAL');
  assert.equal(unattributed.sales.unattributedRejectedRows, 2);
});

test('rejections are classified so unmatched item, branch and lot are counted apart', () => {
  assert.equal(classifyImportError('Unknown Item Code: X1'), 'UNMATCHED_ITEM');
  assert.equal(classifyImportError('Unknown or ambiguous Item Name: Foo'), 'UNMATCHED_ITEM');
  assert.equal(classifyImportError('Item Name is unknown or ambiguous: Foo'), 'UNMATCHED_ITEM');
  assert.equal(classifyImportError('Unknown branch/location: Nowhere'), 'UNMATCHED_BRANCH');
  assert.equal(classifyImportError('Lot L-9 was not found for this item'), 'UNMATCHED_LOT');
  assert.equal(classifyImportError('Item SKU-3 is archived and cannot be imported.'), 'ARCHIVED_ITEM');
  assert.equal(classifyImportError('Quantity must be a valid number'), 'OTHER');

  const counters = summarizeRowCounters([
    { status: 'VALID' }, { status: 'VALID' }, { status: 'DUPLICATE' },
    { status: 'INVALID', errors: ['Unknown Item Code: A'] },
    { status: 'INVALID', errors: ['Unknown branch/location: Z'] },
    // One row with two problems is counted once, under the most specific reason.
    { status: 'INVALID', errors: ['Quantity must be a valid number', 'Unknown branch/location: Q'] },
    { status: 'INVALID', errors: ['Item SKU-3 is archived and cannot be imported.'] },
    { status: 'INVALID', errors: ['Date invalid'] },
    { status: 'INVALID', errors: null },
  ]);
  assert.deepEqual(counters, { total: 9, valid: 2, duplicate: 1, unmatchedItem: 1, unmatchedBranch: 2, unmatchedLot: 0, archivedItem: 1, rejected: 2 });
});

test('a backfilled older file never moves a branch checkpoint backwards', () => {
  syncCheckpoints.splice(0, syncCheckpoints.length);
  const base = { locationId: 'loc-1', sourceType: 'SALES' as const };
  upsertSyncCheckpoint({ ...base, syncedThroughAt: '2026-09-18T10:00:00.000Z', lastImportBatchId: 'today' });
  upsertSyncCheckpoint({ ...base, syncedThroughAt: '2026-09-10T10:00:00.000Z', lastImportBatchId: 'backfill' });
  assert.equal(syncCheckpoints.length, 1);
  assert.deepEqual([syncCheckpoints[0].syncedThroughAt, syncCheckpoints[0].lastImportBatchId], ['2026-09-18T10:00:00.000Z', 'today']);
  upsertSyncCheckpoint({ ...base, syncedThroughAt: '2026-09-19T10:00:00.000Z', lastImportBatchId: 'tomorrow' });
  assert.equal(syncCheckpoints[0].lastImportBatchId, 'tomorrow');
});
