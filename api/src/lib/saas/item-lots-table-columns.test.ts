import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane, ControlPlaneError, isTableKey } from './control-plane.js';

function locked(plane: ControlPlane, companyId = 'default-company') {
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  return plane.requireControlSession(plane.selectCompany(login.user.id, companyId).token).scope;
}
const codeOf = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof ControlPlaneError ? error.code : 'OTHER'; }
  return 'NONE';
};

test('itemLots is a known table with its own built-in columns', () => {
  assert.equal(isTableKey('itemLots'), true);
  assert.equal(isTableKey('nope'), false);
  const plane = new ControlPlane();
  assert.deepEqual(
    plane.getDraftColumns(locked(plane), 'itemLots').map((c) => c.key),
    ['lot_no', 'expiry', 'batch', 'purchase_value', 'sale_value', 'status', 'print'],
  );
});

test('item detail lots: reorder, rename, hide, lot number and print stay; published to runtime', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  plane.setStockColumnLayout(scope, [
    { key: 'lot_no', label: 'Lot code' },
    { key: 'sale_value', label: 'MRP' },
    { key: 'purchase_value', visible: false },
  ], 'itemLots');
  assert.equal(codeOf(() => plane.setStockColumnLayout(scope, [{ key: 'print', visible: false }], 'itemLots')), 'COLUMN_REQUIRED');
  assert.equal(codeOf(() => plane.setStockColumnLayout(scope, [{ key: 'lot_no', visible: false }], 'itemLots')), 'COLUMN_REQUIRED');

  plane.publish(scope);
  const live = plane.runtimeConfig('default-company', 'ADMIN').page.tables!.itemLots;
  assert.deepEqual(live.map((c) => c.key), ['lot_no', 'sale_value', 'expiry', 'batch', 'status', 'print']);
  assert.equal(live[0].label, 'Lot code');
  // The other tables are untouched.
  assert.equal(plane.getDraftColumns(scope, 'stock')[0].key, 'item_code');
  assert.equal(plane.getDraftColumns(scope, 'lots')[0].key, 'item_lot');
});

test('item detail lot formulas use lot values only; item fields can be added', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const added = plane.setStockFormulaColumn(scope, { label: 'Margin', formula: 'sale_value - purchase_value', type: 'currency' }, 'itemLots');
  assert.equal(added.page.tables!.itemLots.find((c) => c.source === 'formula')?.key, 'calc_margin');
  assert.equal(codeOf(() => plane.setStockFormulaColumn(scope, { label: 'X', formula: 'quantity + 1' }, 'itemLots')), 'INVALID_FORMULA');
  plane.addItemFieldColumn(scope, { fieldName: 'Shelf Rack' }, 'itemLots');
  assert.equal(codeOf(() => plane.addItemFieldColumn(scope, { fieldName: 'Shelf Rack' }, 'itemLots')), 'DUPLICATE_COLUMN');
});
