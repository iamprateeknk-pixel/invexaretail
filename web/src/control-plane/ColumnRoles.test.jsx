import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPayload, ROLE_OPTIONS, rolesSummary, toggleRole } from './StockColumnsLayoutEditor.jsx';

test('rolesSummary says who can see a column in plain words', () => {
  assert.equal(rolesSummary(undefined), 'Everyone');
  assert.equal(rolesSummary([]), 'Everyone');
  assert.equal(rolesSummary(ROLE_OPTIONS.map((r) => r.value)), 'Everyone');
  assert.equal(rolesSummary(['ADMIN', 'BRANCH_MANAGER']), 'Only Admin, Branch manager');
});

test('toggleRole starts from everyone, always keeps Admin, and collapses back to everyone', () => {
  const restricted = toggleRole(undefined, 'STORE_USER');
  assert.deepEqual(restricted, ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER', 'AUDITOR']);
  assert.deepEqual(toggleRole(restricted, 'AUDITOR'), ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER']);
  assert.equal(toggleRole(restricted, 'STORE_USER'), undefined, 'adding the last role back means everyone');
  assert.deepEqual(toggleRole(['ADMIN', 'AUDITOR'], 'ADMIN'), ['ADMIN', 'AUDITOR'], 'Admin cannot be switched off');
  assert.deepEqual(toggleRole(['ADMIN', 'AUDITOR'], 'AUDITOR'), ['ADMIN']);
});

test('layoutPayload sends the role list, or null when everyone can see the column', () => {
  const payload = layoutPayload([
    { key: 'a', label: 'A', visibleRoles: ['ADMIN', 'AUDITOR'] },
    { key: 'b', label: 'B' },
    { key: 'c', label: 'C', visibleRoles: [] },
  ]);
  assert.deepEqual(payload.map((p) => p.visibleRoles), [['ADMIN', 'AUDITOR'], null, null]);
});
