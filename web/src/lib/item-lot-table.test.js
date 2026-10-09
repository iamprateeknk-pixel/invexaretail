import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ITEM_LOT_COLUMNS, checkItemLotFormula, itemLotCellText, itemLotColumns, itemLotFormulaValue, itemLotValues } from './item-lot-table.js';

const now = new Date('2026-10-01T10:00:00');
const lot = { id: 'l1', lotNo: 'L-9', status: 'AVAILABLE', expiryDate: '2026-10-22T00:00:00', attributes: { batch: 'B7', purchaseValue: 800, saleValue: 1000 } };

test('item lot columns follow configured order, labels, hidden and role rules', () => {
  const page = { tables: { itemLots: [
    { key: 'lot_no', label: 'Lot code', visible: true },
    { key: 'sale_value', label: 'MRP', visible: true },
    { key: 'purchase_value', label: 'Cost', visible: false },
    { key: 'calc_margin', label: 'Margin', visible: true, visibleRoles: ['ADMIN'] },
    { key: 'print', label: 'Print', visible: true },
  ] } };
  assert.deepEqual(itemLotColumns(page, { role: 'ADMIN' }).map((c) => c.label), ['Lot code', 'MRP', 'Margin', 'Print']);
  assert.deepEqual(itemLotColumns(page, { role: 'AUDITOR' }).map((c) => c.label), ['Lot code', 'MRP', 'Print']);
});

test('item lot columns fall back to the defaults without config or without the lot number / print column', () => {
  const defaults = DEFAULT_ITEM_LOT_COLUMNS.map((c) => c.key);
  assert.deepEqual(itemLotColumns(undefined).map((c) => c.key), defaults);
  assert.deepEqual(itemLotColumns({ tables: { itemLots: [{ key: 'batch', label: 'B', visible: true }] } }).map((c) => c.key), defaults);
});

test('lot values: days to expiry, purchase and sale; missing numbers stay undefined', () => {
  assert.deepEqual(itemLotValues(lot, now), { days_to_expiry: 21, purchase_value: 800, sale_value: 1000 });
  assert.equal(itemLotValues({ attributes: {} }, now).days_to_expiry, undefined);
  assert.equal(itemLotValues({ attributes: {} }, now).sale_value, undefined);
});

test('formulas: margin and weeks work, no expiry or missing value shows a dash, quantity is not available', () => {
  assert.equal(itemLotFormulaValue('sale_value - purchase_value', lot, now), 200);
  assert.equal(itemLotFormulaValue('round(days_to_expiry / 7, 1)', lot, now), 3);
  assert.equal(itemLotFormulaValue('days_to_expiry / 7', { attributes: {} }, now), null);
  const result = checkItemLotFormula('quantity + 1', itemLotValues(lot, now));
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown field "quantity"/);
});

test('cell text renders each built-in field, calculated columns and item fields', () => {
  assert.equal(itemLotCellText({ key: 'lot_no' }, lot), 'L-9');
  assert.equal(itemLotCellText({ key: 'batch' }, lot), 'B7');
  assert.equal(itemLotCellText({ key: 'batch' }, { lotNo: 'x' }), '—');
  assert.equal(itemLotCellText({ key: 'sale_value' }, lot), '₹1,000');
  assert.equal(itemLotCellText({ key: 'expiry' }, { lotNo: 'x' }), 'No date');
  assert.equal(itemLotCellText({ key: 'calc_m', formula: 'sale_value - purchase_value', type: 'currency' }, lot, { now }), '₹200');
  assert.equal(itemLotCellText({ key: 'field_rack', source: 'itemField', itemField: 'Shelf Rack' }, lot, { itemFieldValues: { i1: { 'Shelf Rack': 'R-7' } }, itemId: 'i1' }), 'R-7');
});
