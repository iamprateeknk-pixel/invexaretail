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

test('an item custom field can be shown as a stock column, published, and removed', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const draft = plane.addItemFieldColumn(scope, { fieldName: 'Shelf Rack', label: 'Rack' });
  const column = draft.page.columns.find((entry) => entry.source === 'itemField')!;
  assert.deepEqual([column.key, column.label, column.itemField], ['field_shelf_rack', 'Rack', 'Shelf Rack']);

  plane.publish(scope);
  const live = plane.runtimeConfig('default-company', 'ADMIN').page.columns.find((entry) => entry.key === column.key);
  assert.equal(live?.itemField, 'Shelf Rack');

  const removed = plane.clearStockFormula(scope, column.key);
  assert.equal(removed.page.columns.some((entry) => entry.key === column.key), false);
});

test('item field columns reject blanks and duplicates, default the label, and stay per company', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  assert.equal(codeOf(() => plane.addItemFieldColumn(scope, { fieldName: '   ' })), 'INVALID_ITEM_FIELD');
  const added = plane.addItemFieldColumn(scope, { fieldName: 'MRP' });
  assert.equal(added.page.columns.find((entry) => entry.itemField === 'MRP')?.label, 'MRP');
  assert.equal(codeOf(() => plane.addItemFieldColumn(scope, { fieldName: 'MRP' })), 'DUPLICATE_COLUMN');
  const other = plane.ensureDraft(locked(plane, 'company-jaipur'));
  assert.equal(other.page.columns.some((entry) => entry.source === 'itemField'), false);
});
