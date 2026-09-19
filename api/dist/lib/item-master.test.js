"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const item_master_js_1 = require("./item-master.js");
const item = (over) => ({ lots: [], ...over });
const catalog = [
    item({ id: 'i1', code: 'SKU-1', name: 'Rice 5kg', barcode: '8901234567890', aliases: ['RICE-5', 'Basmati 5 kg'] }),
    item({ id: 'i2', code: 'SKU-2', name: 'Milk 1L' }),
    item({ id: 'i3', code: 'SKU-3', name: 'Old Milk', status: 'ARCHIVED', archiveReason: 'discontinued' }),
    item({ id: 'i4', code: 'SKU-4', name: 'Milk 1L' }),
];
(0, node_test_1.default)('master fields are validated and only provided keys are returned', () => {
    strict_1.default.deepEqual((0, item_master_js_1.parseItemMasterFields)({}), {});
    strict_1.default.deepEqual((0, item_master_js_1.parseItemMasterFields)({ barcode: ' 890 ', hsn: '1006', gstRate: '5', mrp: 120.5, leadTimeDays: 7, shelfLifeDays: 365, aliases: ['A', ' a ', 'B  C', ''] }), { barcode: '890', hsn: '1006', gstRate: 5, mrp: 120.5, leadTimeDays: 7, shelfLifeDays: 365, aliases: ['A', 'B C'] });
    // null / empty clears a field.
    const cleared = (0, item_master_js_1.parseItemMasterFields)({ barcode: null, mrp: '', aliases: [] });
    strict_1.default.equal('barcode' in cleared && cleared.barcode === undefined, true);
    strict_1.default.equal(cleared.mrp, undefined);
    strict_1.default.equal(cleared.aliases, undefined);
    for (const bad of [{ gstRate: 101 }, { gstRate: -1 }, { mrp: -5 }, { leadTimeDays: 1.5 }, { shelfLifeDays: 99999 }, { hsn: 'ab-1' }, { aliases: 'x' }, { barcode: 'x'.repeat(65) }]) {
        strict_1.default.throws(() => (0, item_master_js_1.parseItemMasterFields)(bad));
    }
    strict_1.default.throws(() => (0, item_master_js_1.parseItemMasterFields)({ aliases: Array.from({ length: 51 }, (_, index) => `alias-${index}`) }), /at most 50/);
});
(0, node_test_1.default)('codes, barcodes and aliases share one namespace across items', () => {
    strict_1.default.equal((0, item_master_js_1.findIdentityConflict)(catalog, 'i2', { code: 'SKU-9' }), null);
    strict_1.default.match((0, item_master_js_1.findIdentityConflict)(catalog, 'i2', { code: 'sku-1' }), /already used as the Item Code of SKU-1/);
    strict_1.default.match((0, item_master_js_1.findIdentityConflict)(catalog, 'i2', { barcode: '8901234567890' }), /barcode/);
    strict_1.default.match((0, item_master_js_1.findIdentityConflict)(catalog, 'i2', { aliases: ['rice-5'] }), /alias/);
    strict_1.default.match((0, item_master_js_1.findIdentityConflict)(catalog, 'i2', { aliases: ['SKU-1'] }), /Item Code/);
    // An item never conflicts with itself.
    strict_1.default.equal((0, item_master_js_1.findIdentityConflict)(catalog, 'i1', { barcode: '8901234567890', aliases: ['RICE-5'] }), null);
});
(0, node_test_1.default)('resolution order is code, barcode, alias, then a unique name', () => {
    strict_1.default.deepEqual([(0, item_master_js_1.resolveItemByIdentity)(catalog, { code: 'sku-1' }).item?.id, (0, item_master_js_1.resolveItemByIdentity)(catalog, { code: 'sku-1' }).via], ['i1', 'code']);
    strict_1.default.equal((0, item_master_js_1.resolveItemByIdentity)(catalog, { code: '8901234567890' }).via, 'barcode');
    strict_1.default.equal((0, item_master_js_1.resolveItemByIdentity)(catalog, { code: 'rice-5' }).via, 'alias');
    strict_1.default.equal((0, item_master_js_1.resolveItemByIdentity)(catalog, { name: 'basmati 5  kg' }).item?.id, 'i1');
    strict_1.default.equal((0, item_master_js_1.resolveItemByIdentity)(catalog, { name: 'rice 5KG' }).via, 'name');
    // Two items share the name, so it cannot identify either.
    strict_1.default.equal((0, item_master_js_1.resolveItemByIdentity)(catalog, { name: 'Milk 1L' }).ambiguous, true);
    strict_1.default.deepEqual((0, item_master_js_1.resolveItemByIdentity)(catalog, { code: 'nope' }), {});
    // An archived match is still returned so callers can say "archived", not "unknown".
    strict_1.default.equal((0, item_master_js_1.resolveItemByIdentity)(catalog, { code: 'SKU-3' }).item?.status, 'ARCHIVED');
});
(0, node_test_1.default)('operational users see only ACTIVE items; admins can reach the rest', () => {
    strict_1.default.equal((0, item_master_js_1.isOperationalItem)({}), true);
    strict_1.default.equal((0, item_master_js_1.isOperationalItem)({ status: 'INACTIVE' }), false);
    const ids = (rows) => rows.map((row) => row.id);
    strict_1.default.deepEqual(ids((0, item_master_js_1.visibleItems)('STORE_USER', catalog)), ['i1', 'i2', 'i4']);
    strict_1.default.deepEqual(ids((0, item_master_js_1.visibleItems)('WAREHOUSE_PICKER', catalog, 'all')), ['i1', 'i2', 'i4']);
    strict_1.default.deepEqual(ids((0, item_master_js_1.visibleItems)('ADMIN', catalog)), ['i1', 'i2', 'i4']);
    strict_1.default.deepEqual(ids((0, item_master_js_1.visibleItems)('ADMIN', catalog, 'ARCHIVED')), ['i3']);
    strict_1.default.deepEqual(ids((0, item_master_js_1.visibleItems)('ADMIN_USER', catalog, 'all')), ['i1', 'i2', 'i3', 'i4']);
    // A filter never widens what a non-admin role can see.
    strict_1.default.deepEqual(ids((0, item_master_js_1.visibleItems)('BRANCH_MANAGER', catalog, 'ARCHIVED')), ['i1', 'i2', 'i4']);
    strict_1.default.equal((0, item_master_js_1.parseStatusFilter)(undefined), 'default');
    strict_1.default.equal((0, item_master_js_1.parseStatusFilter)('all'), 'all');
    strict_1.default.equal((0, item_master_js_1.parseStatusFilter)('archived'), 'ARCHIVED');
    strict_1.default.throws(() => (0, item_master_js_1.parseStatusFilter)('gone'), /status must be/);
});
(0, node_test_1.default)('leaving ACTIVE needs a reason; restoring does not', () => {
    strict_1.default.deepEqual((0, item_master_js_1.parseStatusChange)({ status: 'active' }), { status: 'ACTIVE', reason: undefined });
    strict_1.default.deepEqual((0, item_master_js_1.parseStatusChange)({ status: 'ARCHIVED', reason: ' Discontinued ' }), { status: 'ARCHIVED', reason: 'Discontinued' });
    strict_1.default.throws(() => (0, item_master_js_1.parseStatusChange)({ status: 'ARCHIVED' }), /reason/);
    strict_1.default.throws(() => (0, item_master_js_1.parseStatusChange)({ status: 'INACTIVE', reason: 'no' }), /reason/);
    strict_1.default.throws(() => (0, item_master_js_1.parseStatusChange)({ status: 'DELETED' }), /must be/);
});
(0, node_test_1.default)('any history blocks a permanent delete and is described in plain words', () => {
    strict_1.default.deepEqual((0, item_master_js_1.deleteBlockers)({ stock: 0, counts: 0 }), []);
    const blockers = (0, item_master_js_1.deleteBlockers)({ stock: 2, counts: 1, transfers: 0 });
    strict_1.default.deepEqual(blockers.map((row) => row.key), ['stock', 'counts']);
    strict_1.default.equal((0, item_master_js_1.describeBlockers)(blockers), '2 stock on hand, 1 stock counts');
});
