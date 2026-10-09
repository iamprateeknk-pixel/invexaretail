import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPayload } from './StockColumnsLayoutEditor.jsx';
import { stockTableColumns } from '../lib/stock-table.js';

test('layoutPayload sends key, label and visibility in the edited order', () => {
  const payload = layoutPayload([{ key: 'b', label: 'B', visible: false, source: 'core' }, { key: 'a', label: 'A', source: 'core' }]);
  assert.deepEqual(payload, [{ key: 'b', label: 'B', visible: false, visibleRoles: null }, { key: 'a', label: 'A', visible: true, visibleRoles: null }]);
});

test('the stock table follows the configured order, labels and hidden columns', () => {
  const page = { columns: [
    { key: 'physical', label: 'Qty', source: 'core', visible: true },
    { key: 'item_code', label: 'Item', source: 'core', visible: true },
    { key: 'company', label: 'Company', source: 'core', visible: false },
    { key: 'book', label: 'Book', source: 'core', visible: true },
  ] };
  assert.deepEqual(stockTableColumns(page, { role: 'ADMIN', canViewSystemStock: false }).map((c) => c.label), ['Qty', 'Item']);
  assert.deepEqual(stockTableColumns(page, { role: 'ADMIN', canViewSystemStock: true }).map((c) => c.key), ['physical', 'item_code', 'book']);
});

test('falls back to the default columns when there is no config or the item column is missing', () => {
  assert.equal(stockTableColumns(undefined, { canViewSystemStock: true })[0].key, 'item_code');
  assert.equal(stockTableColumns({ columns: [{ key: 'physical', label: 'Qty', source: 'core', visible: true }] }, { canViewSystemStock: true })[0].key, 'item_code');
});
