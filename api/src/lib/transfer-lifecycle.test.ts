import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidTransferTransitionError,
  assertValidTransferTransition,
  canCreateTransfer,
  canManageTransferDispatch,
  isReceivableStatus,
  parseCartonCount,
} from './transfer-lifecycle.js';
import { createTransferRequest } from './store.js';

test('admins and branch managers dispatch; store users can request but not patch dispatch', () => {
  assert.equal(canManageTransferDispatch('ADMIN'), true);
  assert.equal(canManageTransferDispatch('BRANCH_MANAGER'), true);
  assert.equal(canManageTransferDispatch('STORE_USER'), false);
  assert.equal(canCreateTransfer('STORE_USER'), true);
  assert.equal(canCreateTransfer('WAREHOUSE_PICKER'), false);
});

test('confirm then dispatch is the admin posting path; requested cannot skip pick', () => {
  assert.doesNotThrow(() => assertValidTransferTransition('ADMIN', 'READY_FOR_ADMIN', 'CONFIRMED'));
  assert.doesNotThrow(() => assertValidTransferTransition('ADMIN', 'CONFIRMED', 'DISPATCHED'));
  assert.doesNotThrow(() => assertValidTransferTransition('ADMIN', 'DISPATCHED', 'IN_TRANSIT'));
  assert.throws(() => assertValidTransferTransition('ADMIN', 'REQUESTED', 'DISPATCHED'), InvalidTransferTransitionError);
  assert.throws(() => assertValidTransferTransition('ADMIN', 'PICKING', 'DISPATCHED'), InvalidTransferTransitionError);
});

test('store users cannot mark received through status PATCH', () => {
  assert.throws(() => assertValidTransferTransition('STORE_USER', 'DISPATCHED', 'RECEIVED'), InvalidTransferTransitionError);
  assert.equal(isReceivableStatus('DISPATCHED'), true);
  assert.equal(isReceivableStatus('IN_TRANSIT'), true);
  assert.equal(isReceivableStatus('CONFIRMED'), false);
});

test('pickers can move a requested transfer into pick states', () => {
  assert.doesNotThrow(() => assertValidTransferTransition('WAREHOUSE_PICKER', 'REQUESTED', 'PICKING'));
  assert.doesNotThrow(() => assertValidTransferTransition('WAREHOUSE_PICKER', 'PICKING', 'READY_FOR_ADMIN'));
  assert.throws(() => assertValidTransferTransition('AUDITOR', 'REQUESTED', 'DISPATCHED'), InvalidTransferTransitionError);
});

test('carton count is optional and must be a positive integer when present', () => {
  assert.equal(parseCartonCount(undefined), undefined);
  assert.equal(parseCartonCount('3'), 3);
  assert.throws(() => parseCartonCount(0));
  assert.throws(() => parseCartonCount(1.5));
});

test('createTransferRequest keeps carton count for later labels and dispatch', () => {
  const transfer = createTransferRequest({
    sourceLocationId: 'wh-1',
    destinationLocationId: 'loc-1',
    requestedBy: 'user-admin-1',
    role: 'ADMIN',
    lines: [{ itemId: 'item-1001', lotId: 'lot-1001', quantity: 4 }],
    cartonCount: 2,
    notes: 'Seal photos attached',
  });
  assert.equal(transfer.cartonCount, 2);
  assert.equal(transfer.notes, 'Seal photos attached');
  assert.equal(transfer.status, 'REQUESTED');
});
