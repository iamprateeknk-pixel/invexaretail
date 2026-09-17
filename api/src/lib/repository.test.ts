import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adjustStockLedger,
  createCountAssignment,
  createCountRecord,
  createRecountAssignment,
  findActiveAssignment,
  findPendingCountForLot,
  findStockLedgerEntry,
  findUserById,
  listCountAssignmentsFor,
  listStockMovements,
  markAssignmentSubmitted,
  updateCountReview,
} from './repository.js';

test('approving a count posts the variance to the stock ledger', () => {
  adjustStockLedger('item-test-1', 'lot-test-1', 'loc-test-1', 50);

  createCountRecord({
    id: 'count-test-1',
    itemId: 'item-test-1',
    lotId: 'lot-test-1',
    locationId: 'loc-test-1',
    physicalQuantity: 45,
    bookQty: 50,
    mode: 'manual',
    submittedBy: 'user-store-1',
    role: 'STORE_USER',
    createdAt: new Date().toISOString(),
  });

  const reviewed = updateCountReview('count-test-1', 'APPROVED', 'user-admin-1', 'Shelf damage confirmed');
  assert.equal(reviewed.status, 'APPROVED');
  assert.equal(reviewed.reviewReason, 'Shelf damage confirmed');

  const ledgerEntry = findStockLedgerEntry('item-test-1', 'lot-test-1', 'loc-test-1');
  assert.equal(ledgerEntry?.onHand, 45, 'on-hand should move from 50 to the approved physical count of 45');

  const movement = listStockMovements({ sourceDocument: 'count-test-1' })[0];
  assert.equal(movement?.movementType, 'COUNT_VARIANCE');
  assert.equal(movement?.qtyDelta, -5);
  assert.equal(movement?.beforeBalance, 50);
  assert.equal(movement?.afterBalance, 45);
  assert.equal(reviewed.varianceMovementId, movement?.id);
});

test('rejecting a count leaves the stock ledger untouched', () => {
  adjustStockLedger('item-test-2', 'lot-test-2', 'loc-test-2', 20);

  createCountRecord({
    id: 'count-test-2',
    itemId: 'item-test-2',
    lotId: 'lot-test-2',
    locationId: 'loc-test-2',
    physicalQuantity: 5,
    bookQty: 20,
    mode: 'manual',
    submittedBy: 'user-store-1',
    role: 'STORE_USER',
    createdAt: new Date().toISOString(),
  });

  updateCountReview('count-test-2', 'REJECTED', 'user-admin-1');

  const ledgerEntry = findStockLedgerEntry('item-test-2', 'lot-test-2', 'loc-test-2');
  assert.equal(ledgerEntry?.onHand, 20, 'a rejected count must not change on-hand stock');
});

test('a count cannot be reviewed twice', () => {
  createCountRecord({
    id: 'count-test-3',
    itemId: 'item-test-3',
    lotId: 'lot-test-3',
    locationId: 'loc-test-3',
    physicalQuantity: 5,
    bookQty: 5,
    mode: 'manual',
    submittedBy: 'user-store-1',
    role: 'STORE_USER',
    createdAt: new Date().toISOString(),
  });

  updateCountReview('count-test-3', 'APPROVED', 'user-admin-1');
  assert.throws(() => updateCountReview('count-test-3', 'APPROVED', 'user-admin-1'), /already APPROVED/);
});

test('seeded demo users are resolvable by id', () => {
  const admin = findUserById('user-admin-1');
  assert.equal(admin?.role, 'ADMIN');
  assert.equal(findUserById('user-manager-1')?.role, 'BRANCH_MANAGER');
  assert.equal(findUserById('does-not-exist'), undefined);
});

test('an assignment appears in the assignee task list until it is fulfilled', () => {
  const assignment = createCountAssignment({
    id: 'assign-test-1',
    locationId: 'loc-1',
    itemId: 'item-1001',
    assignedToId: 'user-store-1',
    assignedById: 'user-admin-1',
    countDate: new Date().toISOString(),
  });

  assert.equal(assignment.status, 'ASSIGNED');
  assert.ok(listCountAssignmentsFor('user-store-1').some((row) => row.id === 'assign-test-1'));
  assert.deepEqual(findActiveAssignment('user-store-1', 'item-1001', 'loc-1')?.id, 'assign-test-1');

  markAssignmentSubmitted('assign-test-1', 'count-test-1');

  assert.equal(findActiveAssignment('user-store-1', 'item-1001', 'loc-1'), undefined, 'a submitted assignment is no longer active');
  assert.ok(!listCountAssignmentsFor('user-store-1').some((row) => row.id === 'assign-test-1'), 'a submitted assignment drops off the task list');
});

test('a pending count locks the same lot until it is reviewed', () => {
  createCountRecord({
    id: 'count-lock-1',
    itemId: 'item-lock-1',
    lotId: 'lot-lock-1',
    locationId: 'loc-lock-1',
    physicalQuantity: 3,
    bookQty: 4,
    mode: 'manual',
    submittedBy: 'user-store-1',
    role: 'STORE_USER',
    createdAt: new Date().toISOString(),
  });
  assert.equal(findPendingCountForLot('user-store-1', 'item-lock-1', 'lot-lock-1', 'loc-lock-1')?.id, 'count-lock-1');
  updateCountReview('count-lock-1', 'REJECTED', 'user-admin-1', 'Wrong lot counted');
  assert.equal(findPendingCountForLot('user-store-1', 'item-lock-1', 'lot-lock-1', 'loc-lock-1'), undefined);
});

test('recount leaves the ledger untouched and opens a new assignment', () => {
  adjustStockLedger('item-recount-1', 'lot-recount-1', 'loc-1', 12);
  createCountRecord({
    id: 'count-recount-1',
    itemId: 'item-recount-1',
    lotId: 'lot-recount-1',
    locationId: 'loc-1',
    physicalQuantity: 9,
    bookQty: 12,
    mode: 'manual',
    submittedBy: 'user-store-1',
    role: 'STORE_USER',
    createdAt: new Date().toISOString(),
  });
  const assignment = createCountAssignment({
    id: 'assign-recount-1',
    locationId: 'loc-1',
    itemId: 'item-recount-1',
    assignedToId: 'user-store-1',
    assignedById: 'user-admin-1',
    countDate: new Date().toISOString(),
    dueDate: '2026-09-20T00:00:00.000Z',
    priority: 'NORMAL',
  });
  markAssignmentSubmitted(assignment.id, 'count-recount-1');

  const reviewed = updateCountReview('count-recount-1', 'RECOUNT', 'user-admin-1', 'Please count the back room as well');
  const recount = createRecountAssignment(reviewed, 'user-admin-1');

  assert.equal(reviewed.status, 'RECOUNT');
  assert.equal(findStockLedgerEntry('item-recount-1', 'lot-recount-1', 'loc-1')?.onHand, 12);
  assert.equal(listStockMovements({ sourceDocument: 'count-recount-1' }).length, 0);
  assert.equal(recount.cancelled?.id, 'assign-recount-1');
  assert.equal(recount.cancelled?.status, 'CANCELLED');
  assert.equal(recount.assignment.status, 'ASSIGNED');
  assert.equal(recount.assignment.parentCountId, 'count-recount-1');
  assert.equal(recount.assignment.dueDate, '2026-09-20T00:00:00.000Z');
  assert.equal(findActiveAssignment('user-store-1', 'item-recount-1', 'loc-1')?.id, recount.assignment.id);
});
