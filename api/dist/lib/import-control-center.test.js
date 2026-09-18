"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const import_control_center_js_1 = require("./import-control-center.js");
const repository_js_1 = require("./repository.js");
const locations = [
    { id: 'loc-1', name: 'Main Store', type: 'store' },
    { id: 'loc-2', name: 'Second Store', type: 'store' },
    { id: 'wh-1', name: 'HO Basni', type: 'warehouse' },
];
const activity = (over) => ({
    count: 5, lastTransactionAt: '2026-09-18T12:00:00.000Z', batchIds: ['b1'], ...over,
});
const noRejections = { rejectedByLocation: new Map(), unattributedRejected: { sales: 0, purchases: 0 } };
(0, node_test_1.default)('a business day is bounded in the branch timezone, not UTC', () => {
    // India is UTC+5:30, so 18 Sep local runs 17 Sep 18:30Z to 18 Sep 18:30Z.
    strict_1.default.deepEqual((0, import_control_center_js_1.dayWindow)('2026-09-18', 'Asia/Kolkata'), { from: '2026-09-17T18:30:00.000Z', to: '2026-09-18T18:30:00.000Z' });
    strict_1.default.deepEqual((0, import_control_center_js_1.dayWindow)('2026-09-18', 'UTC'), { from: '2026-09-18T00:00:00.000Z', to: '2026-09-19T00:00:00.000Z' });
    strict_1.default.equal((0, import_control_center_js_1.todayFor)('Asia/Kolkata', new Date('2026-09-18T20:00:00Z')), '2026-09-19');
});
(0, node_test_1.default)('every store is expected to report sales; a store with none is MISSING', () => {
    const report = (0, import_control_center_js_1.buildControlCenter)({
        date: '2026-09-18', timezone: 'Asia/Kolkata', locations,
        activity: [activity({ locationId: 'loc-1', sourceType: 'SALES' })], ...noRejections,
    });
    strict_1.default.equal(report.sales.status, 'PARTIAL');
    strict_1.default.deepEqual(report.sales.branches.map((row) => [row.locationName, row.status]), [['Main Store', 'UPLOADED'], ['Second Store', 'MISSING']]);
    // Warehouses are not expected to report sales.
    strict_1.default.equal(report.sales.branches.some((row) => row.locationId === 'wh-1'), false);
    strict_1.default.equal(report.purchases.status, 'MISSING');
    const all = (0, import_control_center_js_1.buildControlCenter)({
        date: '2026-09-18', timezone: 'Asia/Kolkata', locations,
        activity: [activity({ locationId: 'loc-1', sourceType: 'SALES' }), activity({ locationId: 'loc-2', sourceType: 'SALES', batchIds: ['b2'] })], ...noRejections,
    });
    strict_1.default.equal(all.sales.status, 'UPLOADED');
    strict_1.default.deepEqual(all.sales.batchIds.sort(), ['b1', 'b2']);
    const none = (0, import_control_center_js_1.buildControlCenter)({ date: '2026-09-18', timezone: 'UTC', locations, activity: [], ...noRejections });
    strict_1.default.equal(none.sales.status, 'MISSING');
});
(0, node_test_1.default)('purchases are only listed where they happened; rejected rows make a day PARTIAL', () => {
    const report = (0, import_control_center_js_1.buildControlCenter)({
        date: '2026-09-18', timezone: 'UTC', locations,
        activity: [activity({ locationId: 'wh-1', sourceType: 'PURCHASE', count: 12 }), activity({ locationId: 'loc-1', sourceType: 'SALES' }), activity({ locationId: 'loc-2', sourceType: 'SALES' })],
        rejectedByLocation: new Map([['loc-2', { sales: 3, purchases: 0 }]]),
        unattributedRejected: { sales: 0, purchases: 0 },
    });
    strict_1.default.equal(report.purchases.status, 'UPLOADED');
    strict_1.default.deepEqual(report.purchases.branches.map((row) => row.locationName), ['HO Basni']);
    const second = report.sales.branches.find((row) => row.locationId === 'loc-2');
    strict_1.default.deepEqual([second.status, second.rejectedRows], ['PARTIAL', 3]);
    strict_1.default.equal(report.sales.status, 'PARTIAL');
    // Rows rejected for an unknown branch cannot be attributed but still keep the day from looking clean.
    const unattributed = (0, import_control_center_js_1.buildControlCenter)({
        date: '2026-09-18', timezone: 'UTC', locations,
        activity: [activity({ locationId: 'loc-1', sourceType: 'SALES' }), activity({ locationId: 'loc-2', sourceType: 'SALES' })],
        rejectedByLocation: new Map(), unattributedRejected: { sales: 2, purchases: 0 },
    });
    strict_1.default.equal(unattributed.sales.status, 'PARTIAL');
    strict_1.default.equal(unattributed.sales.unattributedRejectedRows, 2);
});
(0, node_test_1.default)('rejections are classified so unmatched item, branch and lot are counted apart', () => {
    strict_1.default.equal((0, import_control_center_js_1.classifyImportError)('Unknown Item Code: X1'), 'UNMATCHED_ITEM');
    strict_1.default.equal((0, import_control_center_js_1.classifyImportError)('Unknown or ambiguous Item Name: Foo'), 'UNMATCHED_ITEM');
    strict_1.default.equal((0, import_control_center_js_1.classifyImportError)('Item Name is unknown or ambiguous: Foo'), 'UNMATCHED_ITEM');
    strict_1.default.equal((0, import_control_center_js_1.classifyImportError)('Unknown branch/location: Nowhere'), 'UNMATCHED_BRANCH');
    strict_1.default.equal((0, import_control_center_js_1.classifyImportError)('Lot L-9 was not found for this item'), 'UNMATCHED_LOT');
    strict_1.default.equal((0, import_control_center_js_1.classifyImportError)('Item SKU-3 is archived and cannot be imported.'), 'ARCHIVED_ITEM');
    strict_1.default.equal((0, import_control_center_js_1.classifyImportError)('Quantity must be a valid number'), 'OTHER');
    const counters = (0, import_control_center_js_1.summarizeRowCounters)([
        { status: 'VALID' }, { status: 'VALID' }, { status: 'DUPLICATE' },
        { status: 'INVALID', errors: ['Unknown Item Code: A'] },
        { status: 'INVALID', errors: ['Unknown branch/location: Z'] },
        // One row with two problems is counted once, under the most specific reason.
        { status: 'INVALID', errors: ['Quantity must be a valid number', 'Unknown branch/location: Q'] },
        { status: 'INVALID', errors: ['Item SKU-3 is archived and cannot be imported.'] },
        { status: 'INVALID', errors: ['Date invalid'] },
        { status: 'INVALID', errors: null },
    ]);
    strict_1.default.deepEqual(counters, { total: 9, valid: 2, duplicate: 1, unmatchedItem: 1, unmatchedBranch: 2, unmatchedLot: 0, archivedItem: 1, rejected: 2 });
});
(0, node_test_1.default)('a backfilled older file never moves a branch checkpoint backwards', () => {
    repository_js_1.syncCheckpoints.splice(0, repository_js_1.syncCheckpoints.length);
    const base = { locationId: 'loc-1', sourceType: 'SALES' };
    (0, repository_js_1.upsertSyncCheckpoint)({ ...base, syncedThroughAt: '2026-09-18T10:00:00.000Z', lastImportBatchId: 'today' });
    (0, repository_js_1.upsertSyncCheckpoint)({ ...base, syncedThroughAt: '2026-09-10T10:00:00.000Z', lastImportBatchId: 'backfill' });
    strict_1.default.equal(repository_js_1.syncCheckpoints.length, 1);
    strict_1.default.deepEqual([repository_js_1.syncCheckpoints[0].syncedThroughAt, repository_js_1.syncCheckpoints[0].lastImportBatchId], ['2026-09-18T10:00:00.000Z', 'today']);
    (0, repository_js_1.upsertSyncCheckpoint)({ ...base, syncedThroughAt: '2026-09-19T10:00:00.000Z', lastImportBatchId: 'tomorrow' });
    strict_1.default.equal(repository_js_1.syncCheckpoints[0].lastImportBatchId, 'tomorrow');
});
