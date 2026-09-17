"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COUNT_PRIORITIES = exports.MIN_COUNT_REVIEW_NOTE = void 0;
exports.canManageCountWork = canManageCountWork;
exports.parseCountReviewReason = parseCountReviewReason;
exports.parseCountPriority = parseCountPriority;
exports.parseOptionalDueDate = parseOptionalDueDate;
exports.parseCountReviewStatus = parseCountReviewStatus;
exports.assertCountLocationAccess = assertCountLocationAccess;
exports.displayCountPriority = displayCountPriority;
const inventory_js_1 = require("./inventory.js");
exports.MIN_COUNT_REVIEW_NOTE = 5;
exports.COUNT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'];
const COUNT_MANAGERS = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'];
function canManageCountWork(role) {
    return COUNT_MANAGERS.includes(role);
}
function parseCountReviewReason(value) {
    const reason = typeof value === 'string' ? value.trim() : '';
    if (reason.length < exports.MIN_COUNT_REVIEW_NOTE) {
        throw new Error(`A review note of at least ${exports.MIN_COUNT_REVIEW_NOTE} characters is required.`);
    }
    return reason;
}
function parseCountPriority(value) {
    const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!raw)
        return 'NORMAL';
    if (raw === 'URGENT')
        return 'HIGH';
    if (exports.COUNT_PRIORITIES.includes(raw))
        return raw;
    throw new Error('Priority must be LOW, NORMAL, or HIGH.');
}
function parseOptionalDueDate(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime()))
        throw new Error('Due date is invalid.');
    return date.toISOString();
}
function parseCountReviewStatus(value) {
    const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
    const status = raw === 'APPROVE' ? 'APPROVED' : raw === 'REJECT' ? 'REJECTED' : raw;
    if (!['APPROVED', 'REJECTED', 'RECOUNT'].includes(status)) {
        throw new Error('Review status must be APPROVED, REJECTED, or RECOUNT.');
    }
    return status;
}
function assertCountLocationAccess(context, locationId) {
    if (!(0, inventory_js_1.canAccessLocation)(context, locationId)) {
        throw new Error('This user cannot manage counts at the selected location.');
    }
}
function displayCountPriority(priority, overdue = false) {
    if (overdue || priority === 'HIGH' || priority === 'Urgent')
        return 'Urgent';
    if (priority === 'LOW' || priority === 'Low')
        return 'Low';
    return 'Normal';
}
