import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane, ControlPlaneError } from './control-plane.js';

function locked(plane: ControlPlane, companyId = 'default-company') {
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  return plane.requireControlSession(plane.selectCompany(login.user.id, companyId).token).scope;
}
const codeOf = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof ControlPlaneError ? error.code : 'OTHER'; }
  return 'NONE';
};

test('the Lots table starts from its built-in columns and does not disturb the stock table', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  assert.deepEqual(plane.getDraftColumns(scope, 'lots').map((c) => c.key), ['item_lot', 'quantity', 'expiry', 'risk', 'recommended_action', 'open']);
  assert.equal(plane.getDraftColumns(scope, 'stock')[0].key, 'item_code');
  assert.equal(plane.getDraftColumns(scope, 'stock').some((c) => c.key === 'quantity'), false);
});

test('lots layout: reorder, rename, hide; essential columns cannot be hidden; published to runtime', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  plane.setStockColumnLayout(scope, [
    { key: 'item_lot' },
    { key: 'expiry', label: 'Best before' },
    { key: 'quantity' },
    { key: 'recommended_action', visible: false },
  ], 'lots');
  assert.equal(codeOf(() => plane.setStockColumnLayout(scope, [{ key: 'open', visible: false }], 'lots')), 'COLUMN_REQUIRED');
  assert.equal(codeOf(() => plane.setStockColumnLayout(scope, [{ key: 'item_lot', visible: false }], 'lots')), 'COLUMN_REQUIRED');
  assert.equal(codeOf(() => plane.setStockColumnLayout(scope, [{ key: 'nope' }], 'lots')), 'COLUMN_NOT_FOUND');

  plane.publish(scope);
  const live = plane.runtimeConfig('default-company', 'ADMIN').page.tables!.lots;
  assert.deepEqual(live.map((c) => c.key), ['item_lot', 'expiry', 'quantity', 'risk', 'open']);
  assert.equal(live[1].label, 'Best before');
  // Stock table untouched.
  assert.equal(plane.runtimeConfig('default-company', 'ADMIN').page.columns[0].key, 'item_code');
});

test('lots formulas may use lot numbers only, and item fields can be added', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const added = plane.setStockFormulaColumn(scope, { label: 'Weeks left', formula: 'days_to_expiry / 7', type: 'number' }, 'lots');
  assert.equal(added.page.tables!.lots.find((c) => c.source === 'formula')?.key, 'calc_weeks_left');
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { label: 'X', formula: 'physical + 1' }, 'lots')), 'INVALID_FORMULA');
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { key: 'available', label: 'X', formula: 'quantity' }, 'lots')), 'INVALID_COLUMN_KEY');
  // The same stock-only field is still valid for the stock table.
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { label: 'X', formula: 'physical + 1' }, 'stock')), 'NONE');

  plane.addItemFieldColumn(scope, { fieldName: 'Shelf Rack' }, 'lots');
  assert.equal(codeOf(() => plane.addItemFieldColumn(scope, { fieldName: 'Shelf Rack' }, 'lots')), 'DUPLICATE_COLUMN');
  const cleared = plane.clearStockFormula(scope, 'calc_weeks_left', 'lots');
  assert.equal(cleared.page.tables!.lots.some((c) => c.key === 'calc_weeks_left'), false);
});

test('lots layout is per company and survives rollback-style cloning of a version', () => {
  const plane = new ControlPlane();
  plane.setStockColumnLayout(locked(plane, 'company-jaipur'), [{ key: 'risk' }], 'lots');
  assert.equal(plane.getDraftColumns(locked(plane, 'default-company'), 'lots')[0].key, 'item_lot');
  const scope = locked(plane, 'company-jaipur');
  plane.publish(scope);
  const next = plane.ensureDraft(scope);
  assert.equal(next.page.tables!.lots[0].key, 'risk', 'a new draft is cloned from the published layout, tables included');
});
