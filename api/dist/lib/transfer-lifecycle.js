"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidTransferTransitionError = void 0;
exports.canManageTransferDispatch = canManageTransferDispatch;
exports.canCreateTransfer = canCreateTransfer;
exports.allowedTransferTransitions = allowedTransferTransitions;
exports.assertValidTransferTransition = assertValidTransferTransition;
exports.parseCartonCount = parseCartonCount;
exports.isReceivableStatus = isReceivableStatus;
class InvalidTransferTransitionError extends Error {
    from;
    to;
    role;
    constructor(from, to, role) {
        super(role
            ? `${role} cannot change transfer from ${from} to ${to}.`
            : `Cannot move transfer from ${from} to ${to}.`);
        this.from = from;
        this.to = to;
        this.role = role;
        this.name = 'InvalidTransferTransitionError';
    }
}
exports.InvalidTransferTransitionError = InvalidTransferTransitionError;
const TRANSFER_MANAGERS = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'];
const TRANSFER_CREATORS = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER'];
function canManageTransferDispatch(role) {
    return TRANSFER_MANAGERS.includes(role);
}
function canCreateTransfer(role) {
    return TRANSFER_CREATORS.includes(role);
}
const PATCH_TRANSITIONS = {
    ADMIN: {
        DRAFT: ['PENDING_PICK', 'CANCELLED'],
        PENDING_PICK: ['CANCELLED'],
        REQUESTED: ['REJECTED', 'CANCELLED'],
        PICKED: ['REJECTED', 'CANCELLED'],
        PARTIAL: ['CONFIRMED', 'CANCELLED'],
        READY_FOR_ADMIN: ['CONFIRMED', 'CANCELLED'],
        CONFIRMED: ['DISPATCHED', 'CANCELLED'],
        DISPATCHED: ['IN_TRANSIT'],
        RECEIVED: ['CLOSED'],
    },
    ADMIN_USER: {
        DRAFT: ['PENDING_PICK', 'CANCELLED'],
        PENDING_PICK: ['CANCELLED'],
        REQUESTED: ['REJECTED', 'CANCELLED'],
        PICKED: ['REJECTED', 'CANCELLED'],
        PARTIAL: ['CONFIRMED', 'CANCELLED'],
        READY_FOR_ADMIN: ['CONFIRMED', 'CANCELLED'],
        CONFIRMED: ['DISPATCHED', 'CANCELLED'],
        DISPATCHED: ['IN_TRANSIT'],
        RECEIVED: ['CLOSED'],
    },
    BRANCH_MANAGER: {
        DRAFT: ['PENDING_PICK', 'CANCELLED'],
        PENDING_PICK: ['CANCELLED'],
        REQUESTED: ['REJECTED', 'CANCELLED'],
        PICKED: ['REJECTED', 'CANCELLED'],
        PARTIAL: ['CONFIRMED', 'CANCELLED'],
        READY_FOR_ADMIN: ['CONFIRMED', 'CANCELLED'],
        CONFIRMED: ['DISPATCHED', 'CANCELLED'],
        DISPATCHED: ['IN_TRANSIT'],
        RECEIVED: ['CLOSED'],
    },
    STORE_USER: {},
    WAREHOUSE_PICKER: {
        REQUESTED: ['PICKING', 'PICKED'],
        PENDING_PICK: ['PICKING', 'PARTIAL', 'READY_FOR_ADMIN'],
        PICKING: ['PARTIAL', 'READY_FOR_ADMIN'],
        PARTIAL: ['PICKING', 'READY_FOR_ADMIN'],
    },
    AUDITOR: {},
};
function allowedTransferTransitions(role, from) {
    return PATCH_TRANSITIONS[role][from] ?? [];
}
function assertValidTransferTransition(role, from, to) {
    if (!allowedTransferTransitions(role, from).includes(to)) {
        throw new InvalidTransferTransitionError(from, to, role);
    }
}
function parseCartonCount(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1) {
        throw new Error('Carton count must be a whole number of at least 1.');
    }
    return count;
}
function isReceivableStatus(status) {
    return ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED'].includes(status);
}
