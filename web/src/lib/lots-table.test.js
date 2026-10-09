import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOT_COLUMNS, checkLotFormula, lotFormulaValue, lotRowValues, lotTableColumns } from './lots-table.js';

const lot = { quantity: 40, daysUntilExpiry: 21, purchaseValue: 800, saleValue: 1000 };

test('lot columns follow the configured order, labels and hidden columns', () => {
  const page = { tables: { lots: [
    { key: 'open', label: 'Open', source: 'core', visible: true },
    { key: 'item_lot', label: 'Product', source: 'core', visible: true },
    { key: 'risk', label: 'Risk', source: 'core', visible: false },
    { key: 'expiry', label: 'Best before', source: 'core', visible: true },
  ] } };
  assert.deepEqual(lotTableColumns(page, { role: 'ADMIN' }).map((c) => c.label), ['Open', 'Product', 'Best before']);
});

test('lot columns fall back to the defaults without a config or without the item / action column', () => {
  assert.deepEqual(lotTableColumns(undefined).map((c) => c.key), DEFAULT_LOT_COLUMNS.map((c) => c.key));
  assert.deepEqual(lotTableColumns({ tables: { lots: [] } }).map((c) => c.key), DEFAULT_LOT_COLUMNS.map((c) => c.key));
  assert.deepEqual(lotTableColumns({ tables: { lots: [{ key: 'expiry', label: 'E', visible: true }] } }).map((c) => c.key), DEFAULT_LOT_COLUMNS.map((c) => c.key));
});

test('role visibility applies to lot columns', () => {
  const page = { tables: { lots: [
    { key: 'item_lot', label: 'Item', visible: true },
    { key: 'calc_value', label: 'Value', visible: true, visibleRoles: ['ADMIN'] },
    { key: 'open', label: 'Open', visible: true },
  ] } };
  assert.equal(lotTableColumns(page, { role: 'ADMIN' }).length, 3);
  assert.equal(lotTableColumns(page, { role: 'AUDITOR' }).length, 2);
});

test('lot formulas read quantity, days to expiry and values; no expiry date gives no value', () => {
  assert.equal(lotFormulaValue('round(days_to_expiry / 7, 1)', lot), 3);
  assert.equal(lotFormulaValue('if(days_to_expiry <= 30, sale_value, 0)', lot), 1000);
  assert.equal(lotFormulaValue('quantity * 2', lot), 80);
  assert.equal(lotFormulaValue('days_to_expiry / 7', { ...lot, daysUntilExpiry: null }), null);
  assert.equal(lotRowValues({ quantity: 5 }).days_to_expiry, undefined);
});

test('stock-only fields are rejected in a lots formula with a plain message', () => {
  const result = checkLotFormula('physical + 1', lotRowValues(lot));
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown field "physical"/);
});
