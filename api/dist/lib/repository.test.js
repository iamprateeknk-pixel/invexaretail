"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const repository_js_1 = require("./repository.js");
// Bare-id call-site migration slice 8 (see docs/tenant-scope-coverage.md):
// the in-memory Transfer/StockCount mirror carried no companyId field at
// all before this slice, so core.ts's bare-id lookups depended entirely
// on the separate in-memory location-ownership map for tenant isolation,
// not a real field on the record itself. This proves the field round-trips
// through both records' create/list functions, which is what every real
// production creation call site (routes/core.ts, lib/transfer-command-service.ts)
// now relies on.
(0, node_test_1.default)('createTransferRecord and createCountRecord preserve a companyId, so a caller no longer has to rely on the location-ownership map alone', () => {
    (0, repository_js_1.createTransferRecord)({
        id: 'transfer-companyid-test-1',
        sourceLocationId: 'wh-1',
        destinationLocationId: 'loc-1',
        requestedBy: 'user-admin-1',
        role: 'ADMIN',
        status: 'REQUESTED',
        lines: [{ itemId: 'item-1001', lotId: 'lot-1001', quantity: 1 }],
        createdAt: new Date().toISOString(),
        companyId: 'default-company',
    });
    const transfer = (0, repository_js_1.listTransfers)().find((row) => row.id === 'transfer-companyid-test-1');
    strict_1.default.equal(transfer?.companyId, 'default-company');
    (0, repository_js_1.createCountRecord)({
        id: 'count-companyid-test-1',
        itemId: 'item-test-companyid',
        lotId: 'lot-test-companyid',
        locationId: 'loc-test-companyid',
        physicalQuantity: 1,
        bookQty: 1,
        mode: 'manual',
        submittedBy: 'user-store-1',
        role: 'STORE_USER',
        createdAt: new Date().toISOString(),
        companyId: 'default-company',
    });
    const count = (0, repository_js_1.listCounts)().find((row) => row.id === 'count-companyid-test-1');
    strict_1.default.equal(count?.companyId, 'default-company');
});
(0, node_test_1.default)('approving a count posts the variance to the stock ledger', () => {
    (0, repository_js_1.adjustStockLedger)('item-test-1', 'lot-test-1', 'loc-test-1', 50);
    (0, repository_js_1.createCountRecord)({
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
    const reviewed = (0, repository_js_1.updateCountReview)('count-test-1', 'APPROVED', 'user-admin-1', 'Shelf damage confirmed');
    strict_1.default.equal(reviewed.status, 'APPROVED');
    strict_1.default.equal(reviewed.reviewReason, 'Shelf damage confirmed');
    const ledgerEntry = (0, repository_js_1.findStockLedgerEntry)('item-test-1', 'lot-test-1', 'loc-test-1');
    strict_1.default.equal(ledgerEntry?.onHand, 45, 'on-hand should move from 50 to the approved physical count of 45');
    const movement = (0, repository_js_1.listStockMovements)({ sourceDocument: 'count-test-1' })[0];
    strict_1.default.equal(movement?.movementType, 'COUNT_VARIANCE');
    strict_1.default.equal(movement?.qtyDelta, -5);
    strict_1.default.equal(movement?.beforeBalance, 50);
    strict_1.default.equal(movement?.afterBalance, 45);
    strict_1.default.equal(reviewed.varianceMovementId, movement?.id);
});
(0, node_test_1.default)('rejecting a count leaves the stock ledger untouched', () => {
    (0, repository_js_1.adjustStockLedger)('item-test-2', 'lot-test-2', 'loc-test-2', 20);
    (0, repository_js_1.createCountRecord)({
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
    (0, repository_js_1.updateCountReview)('count-test-2', 'REJECTED', 'user-admin-1');
    const ledgerEntry = (0, repository_js_1.findStockLedgerEntry)('item-test-2', 'lot-test-2', 'loc-test-2');
    strict_1.default.equal(ledgerEntry?.onHand, 20, 'a rejected count must not change on-hand stock');
});
(0, node_test_1.default)('a count cannot be reviewed twice', () => {
    (0, repository_js_1.createCountRecord)({
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
    (0, repository_js_1.updateCountReview)('count-test-3', 'APPROVED', 'user-admin-1');
    strict_1.default.throws(() => (0, repository_js_1.updateCountReview)('count-test-3', 'APPROVED', 'user-admin-1'), /already APPROVED/);
});
(0, node_test_1.default)('seeded demo users are resolvable by id', () => {
    const admin = (0, repository_js_1.findUserById)('user-admin-1');
    strict_1.default.equal(admin?.role, 'ADMIN');
    strict_1.default.equal((0, repository_js_1.findUserById)('user-manager-1')?.role, 'BRANCH_MANAGER');
    strict_1.default.equal((0, repository_js_1.findUserById)('does-not-exist'), undefined);
});
(0, node_test_1.default)('an assignment appears in the assignee task list until it is fulfilled', () => {
    const assignment = (0, repository_js_1.createCountAssignment)({
        id: 'assign-test-1',
        locationId: 'loc-1',
        itemId: 'item-1001',
        assignedToId: 'user-store-1',
        assignedById: 'user-admin-1',
        countDate: new Date().toISOString(),
    });
    strict_1.default.equal(assignment.status, 'ASSIGNED');
    strict_1.default.ok((0, repository_js_1.listCountAssignmentsFor)('user-store-1').some((row) => row.id === 'assign-test-1'));
    strict_1.default.deepEqual((0, repository_js_1.findActiveAssignment)('user-store-1', 'item-1001', 'loc-1')?.id, 'assign-test-1');
    (0, repository_js_1.markAssignmentSubmitted)('assign-test-1', 'count-test-1');
    strict_1.default.equal((0, repository_js_1.findActiveAssignment)('user-store-1', 'item-1001', 'loc-1'), undefined, 'a submitted assignment is no longer active');
    strict_1.default.ok(!(0, repository_js_1.listCountAssignmentsFor)('user-store-1').some((row) => row.id === 'assign-test-1'), 'a submitted assignment drops off the task list');
});
(0, node_test_1.default)('a pending count locks the same lot until it is reviewed', () => {
    (0, repository_js_1.createCountRecord)({
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
    strict_1.default.equal((0, repository_js_1.findPendingCountForLot)('user-store-1', 'item-lock-1', 'lot-lock-1', 'loc-lock-1')?.id, 'count-lock-1');
    (0, repository_js_1.updateCountReview)('count-lock-1', 'REJECTED', 'user-admin-1', 'Wrong lot counted');
    strict_1.default.equal((0, repository_js_1.findPendingCountForLot)('user-store-1', 'item-lock-1', 'lot-lock-1', 'loc-lock-1'), undefined);
});
(0, node_test_1.default)('recount leaves the ledger untouched and opens a new assignment', () => {
    (0, repository_js_1.adjustStockLedger)('item-recount-1', 'lot-recount-1', 'loc-1', 12);
    (0, repository_js_1.createCountRecord)({
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
    const assignment = (0, repository_js_1.createCountAssignment)({
        id: 'assign-recount-1',
        locationId: 'loc-1',
        itemId: 'item-recount-1',
        assignedToId: 'user-store-1',
        assignedById: 'user-admin-1',
        countDate: new Date().toISOString(),
        dueDate: '2026-09-20T00:00:00.000Z',
        priority: 'NORMAL',
    });
    (0, repository_js_1.markAssignmentSubmitted)(assignment.id, 'count-recount-1');
    const reviewed = (0, repository_js_1.updateCountReview)('count-recount-1', 'RECOUNT', 'user-admin-1', 'Please count the back room as well');
    const recount = (0, repository_js_1.createRecountAssignment)(reviewed, 'user-admin-1');
    strict_1.default.equal(reviewed.status, 'RECOUNT');
    strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-recount-1', 'lot-recount-1', 'loc-1')?.onHand, 12);
    strict_1.default.equal((0, repository_js_1.listStockMovements)({ sourceDocument: 'count-recount-1' }).length, 0);
    strict_1.default.equal(recount.cancelled?.id, 'assign-recount-1');
    strict_1.default.equal(recount.cancelled?.status, 'CANCELLED');
    strict_1.default.equal(recount.assignment.status, 'ASSIGNED');
    strict_1.default.equal(recount.assignment.parentCountId, 'count-recount-1');
    strict_1.default.equal(recount.assignment.dueDate, '2026-09-20T00:00:00.000Z');
    strict_1.default.equal((0, repository_js_1.findActiveAssignment)('user-store-1', 'item-recount-1', 'loc-1')?.id, recount.assignment.id);
});
