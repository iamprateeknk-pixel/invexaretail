import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMULA_RECIPES, insertAtCursor } from './FormulaBuilder.jsx';
import { checkStockFormula, formulaUsesSystemStock, formatStockFormulaValue, stockFormulaValue, stockTableColumns } from '../lib/stock-table.js';

const sample = { physical: 100, book: 90, variance: 10, quarantine: 5, reserved: 20, value: 2500 };

test('every ready-made recipe is valid and gives a sensible number', () => {
  for (const recipe of FORMULA_RECIPES) {
    const result = checkStockFormula(recipe.formula, sample);
    assert.equal(result.ok, true, `${recipe.label}: ${result.error}`);
  }
  assert.equal(checkStockFormula(FORMULA_RECIPES[0].formula, sample).value, 75);
});

test('insertAtCursor keeps the formula readable', () => {
  assert.deepEqual(insertAtCursor('', 'physical', 0, 0), { text: 'physical', cursor: 8 });
  assert.equal(insertAtCursor('physical', '-', 8, 8).text, 'physical - ');
  assert.equal(insertAtCursor('physical - ', 'reserved', 11, 11).text, 'physical - reserved');
  assert.equal(insertAtCursor('max(', 'physical', 4, 4).text, 'max(physical');
  assert.equal(insertAtCursor('max(physical', ')', 12, 12).text, 'max(physical)');
  assert.equal(insertAtCursor('a + b', 'book', 1, 5).text, 'a book');
});

test('errors are plain language and never throw', () => {
  assert.match(checkStockFormula('physical +', sample).error, /ends too early/);
  assert.match(checkStockFormula('stock', sample).error, /Unknown field/);
  assert.equal(stockFormulaValue('physical / 0', { physicalQuantity: 4 }), null);
  assert.equal(formatStockFormulaValue(null, 'number'), '—');
  assert.equal(formatStockFormulaValue(1234.567, 'currency'), '₹1,234.57');
});

test('row values map the stock row to formula fields', () => {
  const row = { physicalQuantity: 10, reservedQuantity: 3, quarantineQuantity: 2, bookQuantity: 9, variance: 1, stockValue: 500 };
  assert.equal(stockFormulaValue('physical - reserved - quarantine', row), 5);
  assert.equal(stockFormulaValue('value / physical', row), 50);
});

test('people without system-stock access never see a formula that reads system numbers', () => {
  assert.equal(formulaUsesSystemStock('physical * 2'), false);
  assert.equal(formulaUsesSystemStock('physical - reserved'), true);
  assert.equal(formulaUsesSystemStock('not valid +'), true);
  const page = { columns: [
    { key: 'item_code', label: 'Item', source: 'core', visible: true },
    { key: 'calc_a', label: 'A', source: 'formula', formula: 'physical * 2', visible: true },
    { key: 'calc_b', label: 'B', source: 'formula', formula: 'value * 2', visible: true },
  ] };
  assert.deepEqual(stockTableColumns(page, { role: 'ADMIN', canViewSystemStock: false }).map((c) => c.key), ['item_code', 'calc_a']);
  assert.deepEqual(stockTableColumns(page, { role: 'ADMIN', canViewSystemStock: true }).map((c) => c.key), ['item_code', 'calc_a', 'calc_b']);
});
