import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane, ControlPlaneError, normalizeColumnRoles } from './control-plane.js';

function locked(plane: ControlPlane, companyId = 'default-company') {
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  return plane.requireControlSession(plane.selectCompany(login.user.id, companyId).token).scope;
}
const codeOf = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof ControlPlaneError ? error.code : 'OTHER'; }
  return 'NONE';
};

test('role lists: ADMIN is always included, everyone collapses to no restriction, bad roles are refused', () => {
  assert.equal(normalizeColumnRoles(undefined), undefined);
  assert.equal(normalizeColumnRoles(null), undefined);
  assert.equal(normalizeColumnRoles([]), undefined);
  assert.deepEqual(normalizeColumnRoles(['BRANCH_MANAGER']), ['ADMIN', 'BRANCH_MANAGER']);
  assert.deepEqual(normalizeColumnRoles(['AUDITOR', 'ADMIN_USER', 'AUDITOR']), ['ADMIN', 'ADMIN_USER', 'AUDITOR']);
  assert.equal(normalizeColumnRoles(['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR']), undefined);
  assert.throws(() => normalizeColumnRoles(['NOPE']), (e: { code?: string }) => e.code === 'INVALID_ROLE');
  assert.throws(() => normalizeColumnRoles('ADMIN'), (e: { code?: string }) => e.code === 'INVALID_ROLE');
});

test('a column restricted to some roles reaches runtime only for those roles, and can be opened up again', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  plane.setStockColumnLayout(scope, [{ key: 'book', visibleRoles: ['BRANCH_MANAGER'] }, { key: 'value', visibleRoles: ['AUDITOR'] }]);
  plane.publish(scope);
  const keysFor = (role: string) => plane.runtimeConfig('default-company', role).page.columns.map((c) => c.key);
  assert.equal(keysFor('ADMIN').includes('book'), true, 'ADMIN always sees it');
  assert.equal(keysFor('BRANCH_MANAGER').includes('book'), true);
  assert.equal(keysFor('STORE_USER').includes('book'), false);
  assert.equal(keysFor('BRANCH_MANAGER').includes('value'), false);
  assert.equal(keysFor('AUDITOR').includes('value'), true);

  plane.setStockColumnLayout(scope, [{ key: 'book', visibleRoles: null }]);
  plane.publish(scope);
  assert.equal(keysFor('STORE_USER').includes('book'), true, 'cleared restriction = everyone');
});

test('essential columns cannot be restricted, and the Lots table supports roles too', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  assert.equal(codeOf(() => plane.setStockColumnLayout(scope, [{ key: 'item_code', visibleRoles: ['AUDITOR'] }])), 'COLUMN_REQUIRED');
  assert.equal(codeOf(() => plane.setStockColumnLayout(scope, [{ key: 'open', visibleRoles: ['AUDITOR'] }], 'lots')), 'COLUMN_REQUIRED');
  assert.equal(codeOf(() => plane.setStockColumnLayout(scope, [{ key: 'book', visibleRoles: ['WRONG'] }])), 'INVALID_ROLE');
  plane.setStockColumnLayout(scope, [{ key: 'recommended_action', visibleRoles: ['BRANCH_MANAGER'] }], 'lots');
  plane.publish(scope);
  const lots = (role: string) => plane.runtimeConfig('default-company', role).page.tables!.lots.map((c) => c.key);
  assert.equal(lots('STORE_USER').includes('recommended_action'), false);
  assert.equal(lots('BRANCH_MANAGER').includes('recommended_action'), true);
});
