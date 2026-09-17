import assert from 'node:assert/strict';
import test from 'node:test';
import { canCreateTransfer, transferQueueActions } from './transfer-lifecycle.js';

test('store users can request transfers; pickers cannot', () => {
  assert.equal(canCreateTransfer('STORE_USER'), true);
  assert.equal(canCreateTransfer('BRANCH_MANAGER'), true);
  assert.equal(canCreateTransfer('WAREHOUSE_PICKER'), false);
});

test('queue actions follow confirm then dispatch then receive', () => {
  assert.equal(transferQueueActions('ADMIN', 'REQUESTED').dispatch, false);
  assert.equal(transferQueueActions('ADMIN', 'REQUESTED').receive, false);
  assert.equal(transferQueueActions('ADMIN', 'REQUESTED').inTransit, false);
  assert.equal(transferQueueActions('ADMIN', 'CONFIRMED').dispatch, true);
  assert.equal(transferQueueActions('ADMIN', 'DISPATCHED').inTransit, true);
  assert.equal(transferQueueActions('STORE_USER', 'DISPATCHED').receive, true);
  assert.equal(transferQueueActions('STORE_USER', 'CONFIRMED').receive, false);
  assert.equal(transferQueueActions('ADMIN', 'READY_FOR_ADMIN').confirm, true);
});
