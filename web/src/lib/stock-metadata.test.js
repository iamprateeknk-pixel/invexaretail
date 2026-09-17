import assert from 'node:assert/strict';
import test from 'node:test';
import { isStockActionEnabled, stockActionIsAvailable, visibleStockColumns } from './stock-metadata.js';

const page = {
  columns: [
    { key: 'item_code', label: 'Item', visible: true },
    { key: 'available', label: 'Available', visible: true },
    { key: 'minimum_stock', label: 'Minimum Stock', source: 'custom', visible: true, visibleRoles: ['ADMIN'] },
    { key: 'book', label: 'Book', visible: true },
  ],
  actions: [
    { key: 'export', enabled: false },
    { key: 'scan', enabled: true },
  ],
};

test('published custom stock columns are role-scoped and respect system-stock visibility', () => {
  const admin = visibleStockColumns(page, { role: 'ADMIN', canViewSystemStock: true }).map((column) => column.key);
  const store = visibleStockColumns(page, { role: 'STORE_USER', canViewSystemStock: false }).map((column) => column.key);
  assert.deepEqual(admin, ['item_code', 'available', 'minimum_stock', 'book']);
  assert.deepEqual(store, ['item_code', 'available']);
});

test('disabled export action is hidden after publish', () => {
  assert.equal(isStockActionEnabled(page, 'export'), false);
  assert.equal(isStockActionEnabled(page, 'scan'), true);
  assert.equal(isStockActionEnabled(page, 'unknown'), true);
  assert.equal(stockActionIsAvailable(page, 'export', 'ADMIN'), false);
  assert.equal(stockActionIsAvailable(page, 'scan', 'STORE_USER'), true);
  assert.equal(stockActionIsAvailable(page, 'unknown', 'ADMIN'), false);
  assert.equal(stockActionIsAvailable(undefined, 'export', 'ADMIN'), true);
  assert.equal(stockActionIsAvailable({
    actions: [{ key: 'export', enabled: true, visibleRoles: ['ADMIN'] }],
  }, 'export', 'STORE_USER'), false);
  assert.equal(stockActionIsAvailable({
    actions: [{ key: 'export', enabled: true, visibleRoles: ['ADMIN'] }],
  }, 'export', 'ADMIN'), true);
});
