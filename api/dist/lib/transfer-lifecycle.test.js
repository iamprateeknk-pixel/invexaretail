"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const transfer_lifecycle_js_1 = require("./transfer-lifecycle.js");
const store_js_1 = require("./store.js");
(0, node_test_1.default)('admins and branch managers dispatch; store users can request but not patch dispatch', () => {
    strict_1.default.equal((0, transfer_lifecycle_js_1.canManageTransferDispatch)('ADMIN'), true);
    strict_1.default.equal((0, transfer_lifecycle_js_1.canManageTransferDispatch)('BRANCH_MANAGER'), true);
    strict_1.default.equal((0, transfer_lifecycle_js_1.canManageTransferDispatch)('STORE_USER'), false);
    strict_1.default.equal((0, transfer_lifecycle_js_1.canCreateTransfer)('STORE_USER'), true);
    strict_1.default.equal((0, transfer_lifecycle_js_1.canCreateTransfer)('WAREHOUSE_PICKER'), false);
});
(0, node_test_1.default)('confirm then dispatch is the admin posting path; requested cannot skip pick', () => {
    strict_1.default.doesNotThrow(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('ADMIN', 'READY_FOR_ADMIN', 'CONFIRMED'));
    strict_1.default.doesNotThrow(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('ADMIN', 'CONFIRMED', 'DISPATCHED'));
    strict_1.default.doesNotThrow(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('ADMIN', 'DISPATCHED', 'IN_TRANSIT'));
    strict_1.default.throws(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('ADMIN', 'REQUESTED', 'DISPATCHED'), transfer_lifecycle_js_1.InvalidTransferTransitionError);
    strict_1.default.throws(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('ADMIN', 'PICKING', 'DISPATCHED'), transfer_lifecycle_js_1.InvalidTransferTransitionError);
});
(0, node_test_1.default)('store users cannot mark received through status PATCH', () => {
    strict_1.default.throws(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('STORE_USER', 'DISPATCHED', 'RECEIVED'), transfer_lifecycle_js_1.InvalidTransferTransitionError);
    strict_1.default.equal((0, transfer_lifecycle_js_1.isReceivableStatus)('DISPATCHED'), true);
    strict_1.default.equal((0, transfer_lifecycle_js_1.isReceivableStatus)('IN_TRANSIT'), true);
    strict_1.default.equal((0, transfer_lifecycle_js_1.isReceivableStatus)('CONFIRMED'), false);
});
(0, node_test_1.default)('pickers can move a requested transfer into pick states', () => {
    strict_1.default.doesNotThrow(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('WAREHOUSE_PICKER', 'REQUESTED', 'PICKING'));
    strict_1.default.doesNotThrow(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('WAREHOUSE_PICKER', 'PICKING', 'READY_FOR_ADMIN'));
    strict_1.default.throws(() => (0, transfer_lifecycle_js_1.assertValidTransferTransition)('AUDITOR', 'REQUESTED', 'DISPATCHED'), transfer_lifecycle_js_1.InvalidTransferTransitionError);
});
(0, node_test_1.default)('carton count is optional and must be a positive integer when present', () => {
    strict_1.default.equal((0, transfer_lifecycle_js_1.parseCartonCount)(undefined), undefined);
    strict_1.default.equal((0, transfer_lifecycle_js_1.parseCartonCount)('3'), 3);
    strict_1.default.throws(() => (0, transfer_lifecycle_js_1.parseCartonCount)(0));
    strict_1.default.throws(() => (0, transfer_lifecycle_js_1.parseCartonCount)(1.5));
});
(0, node_test_1.default)('createTransferRequest keeps carton count for later labels and dispatch', () => {
    const transfer = (0, store_js_1.createTransferRequest)({
        sourceLocationId: 'wh-1',
        destinationLocationId: 'loc-1',
        requestedBy: 'user-admin-1',
        role: 'ADMIN',
        lines: [{ itemId: 'item-1001', lotId: 'lot-1001', quantity: 4 }],
        cartonCount: 2,
        notes: 'Seal photos attached',
    });
    strict_1.default.equal(transfer.cartonCount, 2);
    strict_1.default.equal(transfer.notes, 'Seal photos attached');
    strict_1.default.equal(transfer.status, 'REQUESTED');
});
