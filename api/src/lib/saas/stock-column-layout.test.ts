import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane, ControlPlaneError } from './control-plane.js';

function locked(plane: ControlPlane, companyId = 'default-company') {
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const selected = plane.selectCompany(login.user.id, companyId);
  return plane.requireControlSession(selected.token).scope;
}

test('stock column layout reorders, renames and hides columns in the draft, then publishes to runtime', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const draft = plane.setStockColumnLayout(scope, [
    { key: 'physical', label: 'Qty on hand' },
    { key: 'item_code' },
    { key: 'company', visible: false },
  ]);
  assert.deepEqual(draft.page.columns.slice(0, 3).map((column) => column.key), ['physical', 'item_code', 'company']);
  assert.equal(draft.page.columns[0].label, 'Qty on hand');
  // Columns left out of the layout are kept, after the listed ones.
  assert.equal(draft.page.columns.length, 12);

  plane.publish(scope);
  const runtime = plane.runtimeConfig('default-company', 'ADMIN');
  assert.equal(runtime.page.columns[0].key, 'physical');
  assert.equal(runtime.page.columns.some((column) => column.key === 'company'), false);
});

test('stock column layout rejects unknown, duplicate, blank and item-hiding edits', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const code = (fn: () => unknown) => {
    try { fn(); } catch (error) { return error instanceof ControlPlaneError ? error.code : 'OTHER'; }
    return 'NONE';
  };
  assert.equal(code(() => plane.setStockColumnLayout(scope, [{ key: 'nope' }])), 'COLUMN_NOT_FOUND');
  assert.equal(code(() => plane.setStockColumnLayout(scope, [{ key: 'physical' }, { key: 'physical' }])), 'DUPLICATE_COLUMN');
  assert.equal(code(() => plane.setStockColumnLayout(scope, [{ key: 'physical', label: '   ' }])), 'INVALID_COLUMN_LABEL');
  assert.equal(code(() => plane.setStockColumnLayout(scope, [{ key: 'item_code', visible: false }])), 'COLUMN_REQUIRED');
});

test('stock column layout only touches the locked company', () => {
  const plane = new ControlPlane();
  plane.setStockColumnLayout(locked(plane, 'company-jaipur'), [{ key: 'book', visible: false }]);
  const other = plane.ensureDraft(locked(plane, 'default-company'));
  assert.equal(other.page.columns.find((column) => column.key === 'book')?.visible, true);
});
