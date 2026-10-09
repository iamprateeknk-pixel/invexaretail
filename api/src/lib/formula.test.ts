import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { ControlPlane, ControlPlaneError } from './saas/control-plane.js';
import { evaluateFormula, FormulaError, parseFormula, STOCK_FORMULA_FIELDS, validateFormula } from './formula.js';

const values = { physical: 100, book: 90, variance: 10, quarantine: 5, reserved: 20, value: 2500 };
const calc = (formula: string) => evaluateFormula(validateFormula(formula, STOCK_FORMULA_FIELDS), values);

test('arithmetic follows normal precedence, parentheses and unary minus', () => {
  assert.equal(calc('physical - reserved - quarantine'), 75);
  assert.equal(calc('2 + 3 * 4'), 14);
  assert.equal(calc('(2 + 3) * 4'), 20);
  assert.equal(calc('-physical + 150'), 50);
  assert.equal(calc('PHYSICAL * 1.5'), 150);
  assert.equal(calc('physical % 30'), 10);
});

test('functions and comparisons: MAX MIN ROUND ABS FLOOR CEIL IF', () => {
  assert.equal(calc('max(0, quarantine - 10)'), 0);
  assert.equal(calc('min(physical, book, 95)'), 90);
  assert.equal(calc('round(value / 3, 1)'), 833.3);
  assert.equal(calc('round(value / 3)'), 833);
  assert.equal(calc('abs(book - physical)'), 10);
  assert.equal(calc('floor(7.9) + ceil(1.1)'), 9);
  assert.equal(calc('if(variance > 5, 1, 0)'), 1);
  assert.equal(calc('if(reserved >= 30, physical, book)'), 90);
  assert.equal(calc('if(physical = 100, 1, 2)'), 1);
});

test('plain-language errors for unknown fields, bad syntax and wrong argument counts', () => {
  const message = (formula: string) => { try { calc(formula); } catch (error) { return error instanceof FormulaError ? error.message : 'OTHER'; } return 'NONE'; };
  assert.match(message('stock + 1'), /Unknown field "stock"/);
  assert.match(message('physical +'), /ends too early/);
  assert.match(message('physical ** 2'), /Unexpected "\*"/);
  assert.match(message('if(1, 2)'), /IF needs 3/);
  assert.match(message('sqrt(4)'), /Unknown function "SQRT"/);
  assert.match(message('physical $ 2'), /not allowed/);
  assert.match(message('physical / (reserved - 20)'), /Division by zero/);
  assert.match(message(''), /Write a formula/);
  assert.match(message('1 + '.repeat(120)), /at most 300/);
});

test('there is no way to run code: identifiers, brackets and strings are rejected', () => {
  for (const attempt of ['process.exit(1)', 'constructor', 'physical["x"]', '"a"', 'a=>a', '__proto__', 'physical; 1']) {
    assert.throws(() => calc(attempt), FormulaError, attempt);
  }
});

test('deeply nested formulas are refused instead of overflowing the stack', () => {
  assert.throws(() => parseFormula(`${'('.repeat(60)}1${')'.repeat(60)}`), /nested too deeply/);
});

test('web/src/lib/formula.js is the generated copy of this engine', () => {
  const script = path.resolve(process.cwd(), 'scripts/sync-formula-to-web.mjs');
  execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' });
});

function locked(plane: ControlPlane, companyId = 'default-company') {
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  return plane.requireControlSession(plane.selectCompany(login.user.id, companyId).token).scope;
}
const codeOf = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof ControlPlaneError ? error.code : 'OTHER'; }
  return 'NONE';
};

test('calculated stock columns: add, edit, publish to runtime, remove', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const added = plane.setStockFormulaColumn(scope, { label: 'Free stock', formula: 'physical - reserved', type: 'number' });
  const column = added.page.columns.find((entry) => entry.source === 'formula')!;
  assert.equal(column.key, 'calc_free_stock');
  assert.equal(column.formula, 'physical - reserved');

  plane.setStockFormulaColumn(scope, { key: column.key, label: 'Stock value', formula: 'physical * 12', type: 'currency' });
  plane.publish(scope);
  const live = plane.runtimeConfig('default-company', 'ADMIN').page.columns.find((entry) => entry.key === column.key)!;
  assert.deepEqual([live.label, live.formula, live.type], ['Stock value', 'physical * 12', 'currency']);

  const cleared = plane.clearStockFormula(scope, column.key);
  assert.equal(cleared.page.columns.some((entry) => entry.key === column.key), false);
});

test('the built-in Available column can get a formula and be reset', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const draft = plane.setStockFormulaColumn(scope, { key: 'available', label: 'Sellable', formula: 'physical - reserved - quarantine - 2' });
  assert.equal(draft.page.columns.find((entry) => entry.key === 'available')?.formula, 'physical - reserved - quarantine - 2');
  const reset = plane.clearStockFormula(scope, 'available');
  const available = reset.page.columns.find((entry) => entry.key === 'available')!;
  assert.equal(available.formula, undefined);
  assert.equal(available.label, 'Available');
});

test('calculated columns reject bad formulas and bad targets server-side', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { label: 'X', formula: 'stock + 1' })), 'INVALID_FORMULA');
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { label: 'X', formula: 'available + 1' })), 'INVALID_FORMULA');
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { label: '', formula: '1' })), 'INVALID_COLUMN_LABEL');
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { key: 'physical', label: 'X', formula: '1' })), 'INVALID_COLUMN_KEY');
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { key: 'calc_missing', label: 'X', formula: '1' })), 'COLUMN_NOT_FOUND');
  assert.equal(codeOf(() => plane.clearStockFormula(scope, 'physical')), 'NO_FORMULA');
  for (let n = 0; n < 12; n += 1) plane.setStockFormulaColumn(scope, { label: `Col ${n}`, formula: `physical + ${n}` });
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { label: 'One too many', formula: '1' })), 'TOO_MANY_FORMULAS');
});

test('formulas only affect the locked company', () => {
  const plane = new ControlPlane();
  plane.setStockFormulaColumn(locked(plane, 'company-jaipur'), { label: 'Mine', formula: 'physical' });
  const other = plane.ensureDraft(locked(plane, 'default-company'));
  assert.equal(other.page.columns.some((entry) => entry.source === 'formula'), false);
});
