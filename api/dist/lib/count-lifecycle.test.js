"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const count_lifecycle_js_1 = require("./count-lifecycle.js");
(0, node_test_1.default)('admins and branch managers can manage count work; store users cannot', () => {
    strict_1.default.equal((0, count_lifecycle_js_1.canManageCountWork)('ADMIN'), true);
    strict_1.default.equal((0, count_lifecycle_js_1.canManageCountWork)('ADMIN_USER'), true);
    strict_1.default.equal((0, count_lifecycle_js_1.canManageCountWork)('BRANCH_MANAGER'), true);
    strict_1.default.equal((0, count_lifecycle_js_1.canManageCountWork)('STORE_USER'), false);
    strict_1.default.equal((0, count_lifecycle_js_1.canManageCountWork)('AUDITOR'), false);
});
(0, node_test_1.default)('review notes must be at least five characters after trim', () => {
    strict_1.default.equal((0, count_lifecycle_js_1.parseCountReviewReason)(' Damaged cartons found '), 'Damaged cartons found');
    strict_1.default.throws(() => (0, count_lifecycle_js_1.parseCountReviewReason)('nope'), /at least 5 characters/);
    strict_1.default.throws(() => (0, count_lifecycle_js_1.parseCountReviewReason)('   '), /at least 5 characters/);
});
(0, node_test_1.default)('review status accepts approve/reject aliases and recount', () => {
    strict_1.default.equal((0, count_lifecycle_js_1.parseCountReviewStatus)('approve'), 'APPROVED');
    strict_1.default.equal((0, count_lifecycle_js_1.parseCountReviewStatus)('REJECT'), 'REJECTED');
    strict_1.default.equal((0, count_lifecycle_js_1.parseCountReviewStatus)('RECOUNT'), 'RECOUNT');
    strict_1.default.throws(() => (0, count_lifecycle_js_1.parseCountReviewStatus)('PENDING_REVIEW'), /APPROVED, REJECTED, or RECOUNT/);
});
(0, node_test_1.default)('priority aliases urgent to HIGH and defaults blank to NORMAL', () => {
    strict_1.default.equal((0, count_lifecycle_js_1.parseCountPriority)(undefined), 'NORMAL');
    strict_1.default.equal((0, count_lifecycle_js_1.parseCountPriority)('urgent'), 'HIGH');
    strict_1.default.equal((0, count_lifecycle_js_1.parseCountPriority)('low'), 'LOW');
    strict_1.default.throws(() => (0, count_lifecycle_js_1.parseCountPriority)('critical'), /LOW, NORMAL, or HIGH/);
});
(0, node_test_1.default)('optional due dates reject invalid values and keep empty optional', () => {
    strict_1.default.equal((0, count_lifecycle_js_1.parseOptionalDueDate)(''), undefined);
    strict_1.default.ok((0, count_lifecycle_js_1.parseOptionalDueDate)('2026-09-20T12:00:00.000Z')?.startsWith('2026-09-20'));
    strict_1.default.throws(() => (0, count_lifecycle_js_1.parseOptionalDueDate)('not-a-date'), /Due date is invalid/);
});
(0, node_test_1.default)('branch managers are limited to assigned locations for count work', () => {
    const manager = { role: 'BRANCH_MANAGER', assignedLocationIds: ['loc-1'] };
    strict_1.default.doesNotThrow(() => (0, count_lifecycle_js_1.assertCountLocationAccess)(manager, 'loc-1'));
    strict_1.default.throws(() => (0, count_lifecycle_js_1.assertCountLocationAccess)(manager, 'loc-2'), /cannot manage counts/);
    strict_1.default.doesNotThrow(() => (0, count_lifecycle_js_1.assertCountLocationAccess)({ role: 'ADMIN', assignedLocationIds: [] }, 'loc-2'));
});
