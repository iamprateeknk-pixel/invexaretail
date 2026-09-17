import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileHomeForRole, offlineActionSpec, OFFLINE_ACTION_TYPES } from './mobile-role.js';

test('warehouse pickers get pick/putaway/scan instead of the generic count tab', () => {
  const home = mobileHomeForRole('WAREHOUSE_PICKER');
  assert.deepEqual(home.destinations.map((d) => d.id), ['home', 'pick', 'putaway', 'scan']);
  assert.equal(home.defaultDestination, 'pick');
});

test('store users get count + receive, not warehouse picking', () => {
  const home = mobileHomeForRole('STORE_USER');
  assert.deepEqual(home.destinations.map((d) => d.id), ['home', 'count', 'receive', 'stock']);
  assert.equal(home.destinations.some((d) => d.id === 'pick'), false);
});

test('admins keep network tabs including channel orders', () => {
  assert.ok(mobileHomeForRole('ADMIN').destinations.some((d) => d.id === 'orders'));
  assert.equal(mobileHomeForRole('AUDITOR').destinations.some((d) => d.id === 'transfers'), false);
});

test('offline queue covers counts, transfers, receiving, picking, putaway, exceptions and QC', () => {
  assert.deepEqual([...OFFLINE_ACTION_TYPES], ['COUNT', 'TRANSFER_REQUEST', 'TRANSFER_RECEIVE', 'PICK', 'PUTAWAY', 'EXCEPTION', 'QC_INSPECTION']);
  assert.equal(offlineActionSpec('PUTAWAY').endpoint.includes('putaway-tasks'), true);
  assert.equal(offlineActionSpec('TRANSFER_RECEIVE').method, 'POST');
});
