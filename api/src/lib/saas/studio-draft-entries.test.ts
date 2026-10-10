import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane, ControlPlaneError } from './control-plane.js';

function locked(plane: ControlPlane, companyId = 'default-company') {
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const selected = plane.selectCompany(login.user.id, companyId);
  return plane.requireControlSession(selected.token).scope;
}

const code = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof ControlPlaneError ? error.code : 'OTHER'; }
  return 'NONE';
};

test('every kind of draft entry can be removed, and only from the locked company', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  plane.addField(scope, { entityType: 'item', key: 'shelf', name: 'Shelf', type: 'text' });
  let draft = plane.removeDraftEntry(scope, 'fields', 'item:shelf');
  assert.equal(draft.fields.length, 0);
  draft = plane.removeDraftEntry(scope, 'rules', 'high_value_adjustment');
  assert.equal(draft.rules.length, 0);
  draft = plane.removeDraftEntry(scope, 'reports', 'low_stock');
  assert.equal(draft.reports.length, 0);
  draft = plane.removeDraftEntry(scope, 'automations', 'low_stock_notify');
  assert.equal(draft.automations.length, 0);
  draft = plane.removeDraftEntry(scope, 'workflows', 'transfer.approval');
  assert.equal(draft.workflows.length, 0);
  draft = plane.removeDraftEntry(scope, 'mobilePolicies', 'STORE_USER');
  assert.deepEqual(draft.mobilePolicies.map((policy) => policy.role), ['WAREHOUSE_PICKER']);
  assert.equal(code(() => plane.removeDraftEntry(scope, 'rules', 'missing')), 'DRAFT_ENTRY_NOT_FOUND');

  const other = plane.ensureDraft(locked(plane, 'company-jaipur'));
  assert.equal(other.rules.length, 1);
});

test('a field can be edited in place with replace, but a plain add still refuses duplicates and bad keys', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  plane.addField(scope, { entityType: 'item', key: 'shelf', name: 'Shelf', type: 'text' });
  const id = plane.ensureDraft(scope).fields[0].id;
  assert.equal(code(() => plane.addField(scope, { entityType: 'item', key: 'shelf', name: 'Shelf 2', type: 'text' })), 'RESERVED_FIELD');
  const draft = plane.addField(scope, { entityType: 'item', key: 'shelf', name: 'Rack', type: 'number', required: true, replace: true });
  assert.equal(draft.fields.length, 1);
  assert.equal(draft.fields[0].label, 'Rack');
  assert.equal(draft.fields[0].dataType, 'number');
  assert.equal(draft.fields[0].id, id);
  assert.equal(code(() => plane.addField(scope, { entityType: 'item', key: 'Bad Key', name: 'X', type: 'text' })), 'INVALID_FIELD_KEY');
  assert.equal(code(() => plane.addField(scope, { entityType: 'item', key: 'ok', name: '  ', type: 'text' })), 'INVALID_FIELD_NAME');
});
