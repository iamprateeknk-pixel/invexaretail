import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteBlockers,
  describeBlockers,
  findIdentityConflict,
  isOperationalItem,
  parseItemMasterFields,
  parseStatusChange,
  parseStatusFilter,
  resolveItemByIdentity,
  visibleItems,
} from './item-master.js';
import type { ItemRecord } from './repository.js';

const item = (over: Partial<ItemRecord> & { id: string; code: string; name: string }): ItemRecord => ({ lots: [], ...over });

const catalog: ItemRecord[] = [
  item({ id: 'i1', code: 'SKU-1', name: 'Rice 5kg', barcode: '8901234567890', aliases: ['RICE-5', 'Basmati 5 kg'] }),
  item({ id: 'i2', code: 'SKU-2', name: 'Milk 1L' }),
  item({ id: 'i3', code: 'SKU-3', name: 'Old Milk', status: 'ARCHIVED', archiveReason: 'discontinued' }),
  item({ id: 'i4', code: 'SKU-4', name: 'Milk 1L' }),
];

test('master fields are validated and only provided keys are returned', () => {
  assert.deepEqual(parseItemMasterFields({}), {});
  assert.deepEqual(
    parseItemMasterFields({ barcode: ' 890 ', hsn: '1006', gstRate: '5', mrp: 120.5, leadTimeDays: 7, shelfLifeDays: 365, aliases: ['A', ' a ', 'B  C', ''] }),
    { barcode: '890', hsn: '1006', gstRate: 5, mrp: 120.5, leadTimeDays: 7, shelfLifeDays: 365, aliases: ['A', 'B C'] },
  );
  // null / empty clears a field.
  const cleared = parseItemMasterFields({ barcode: null, mrp: '', aliases: [] });
  assert.equal('barcode' in cleared && cleared.barcode === undefined, true);
  assert.equal(cleared.mrp, undefined);
  assert.equal(cleared.aliases, undefined);
  for (const bad of [{ gstRate: 101 }, { gstRate: -1 }, { mrp: -5 }, { leadTimeDays: 1.5 }, { shelfLifeDays: 99999 }, { hsn: 'ab-1' }, { aliases: 'x' }, { barcode: 'x'.repeat(65) }]) {
    assert.throws(() => parseItemMasterFields(bad as Record<string, unknown>));
  }
  assert.throws(() => parseItemMasterFields({ aliases: Array.from({ length: 51 }, (_, index) => `alias-${index}`) }), /at most 50/);
});

test('codes, barcodes and aliases share one namespace across items', () => {
  assert.equal(findIdentityConflict(catalog, 'i2', { code: 'SKU-9' }), null);
  assert.match(findIdentityConflict(catalog, 'i2', { code: 'sku-1' })!, /already used as the Item Code of SKU-1/);
  assert.match(findIdentityConflict(catalog, 'i2', { barcode: '8901234567890' })!, /barcode/);
  assert.match(findIdentityConflict(catalog, 'i2', { aliases: ['rice-5'] })!, /alias/);
  assert.match(findIdentityConflict(catalog, 'i2', { aliases: ['SKU-1'] })!, /Item Code/);
  // An item never conflicts with itself.
  assert.equal(findIdentityConflict(catalog, 'i1', { barcode: '8901234567890', aliases: ['RICE-5'] }), null);
});

test('resolution order is code, barcode, alias, then a unique name', () => {
  assert.deepEqual([resolveItemByIdentity(catalog, { code: 'sku-1' }).item?.id, resolveItemByIdentity(catalog, { code: 'sku-1' }).via], ['i1', 'code']);
  assert.equal(resolveItemByIdentity(catalog, { code: '8901234567890' }).via, 'barcode');
  assert.equal(resolveItemByIdentity(catalog, { code: 'rice-5' }).via, 'alias');
  assert.equal(resolveItemByIdentity(catalog, { name: 'basmati 5  kg' }).item?.id, 'i1');
  assert.equal(resolveItemByIdentity(catalog, { name: 'rice 5KG' }).via, 'name');
  // Two items share the name, so it cannot identify either.
  assert.equal(resolveItemByIdentity(catalog, { name: 'Milk 1L' }).ambiguous, true);
  assert.deepEqual(resolveItemByIdentity(catalog, { code: 'nope' }), {});
  // An archived match is still returned so callers can say "archived", not "unknown".
  assert.equal(resolveItemByIdentity(catalog, { code: 'SKU-3' }).item?.status, 'ARCHIVED');
});

test('operational users see only ACTIVE items; admins can reach the rest', () => {
  assert.equal(isOperationalItem({}), true);
  assert.equal(isOperationalItem({ status: 'INACTIVE' }), false);
  const ids = (rows: ItemRecord[]) => rows.map((row) => row.id);
  assert.deepEqual(ids(visibleItems('STORE_USER', catalog)), ['i1', 'i2', 'i4']);
  assert.deepEqual(ids(visibleItems('WAREHOUSE_PICKER', catalog, 'all')), ['i1', 'i2', 'i4']);
  assert.deepEqual(ids(visibleItems('ADMIN', catalog)), ['i1', 'i2', 'i4']);
  assert.deepEqual(ids(visibleItems('ADMIN', catalog, 'ARCHIVED')), ['i3']);
  assert.deepEqual(ids(visibleItems('ADMIN_USER', catalog, 'all')), ['i1', 'i2', 'i3', 'i4']);
  // A filter never widens what a non-admin role can see.
  assert.deepEqual(ids(visibleItems('BRANCH_MANAGER', catalog, 'ARCHIVED')), ['i1', 'i2', 'i4']);
  assert.equal(parseStatusFilter(undefined), 'default');
  assert.equal(parseStatusFilter('all'), 'all');
  assert.equal(parseStatusFilter('archived'), 'ARCHIVED');
  assert.throws(() => parseStatusFilter('gone'), /status must be/);
});

test('leaving ACTIVE needs a reason; restoring does not', () => {
  assert.deepEqual(parseStatusChange({ status: 'active' }), { status: 'ACTIVE', reason: undefined });
  assert.deepEqual(parseStatusChange({ status: 'ARCHIVED', reason: ' Discontinued ' }), { status: 'ARCHIVED', reason: 'Discontinued' });
  assert.throws(() => parseStatusChange({ status: 'ARCHIVED' }), /reason/);
  assert.throws(() => parseStatusChange({ status: 'INACTIVE', reason: 'no' }), /reason/);
  assert.throws(() => parseStatusChange({ status: 'DELETED' }), /must be/);
});

test('any history blocks a permanent delete and is described in plain words', () => {
  assert.deepEqual(deleteBlockers({ stock: 0, counts: 0 }), []);
  const blockers = deleteBlockers({ stock: 2, counts: 1, transfers: 0 });
  assert.deepEqual(blockers.map((row) => row.key), ['stock', 'counts']);
  assert.equal(describeBlockers(blockers), '2 stock on hand, 1 stock counts');
});
