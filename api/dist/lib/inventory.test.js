"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const inventory_js_1 = require("./inventory.js");
(0, node_test_1.default)('computeVariance returns the physical minus book delta', () => {
    strict_1.default.equal((0, inventory_js_1.computeVariance)(120, 135), 15);
    strict_1.default.equal((0, inventory_js_1.computeVariance)(120, 110), -10);
});
(0, node_test_1.default)('admin can access all locations, while a store user is restricted to assigned stores', () => {
    strict_1.default.equal((0, inventory_js_1.canAccessLocation)({ role: 'ADMIN', assignedLocationIds: ['loc-1', 'loc-2'] }, 'loc-3'), true);
    strict_1.default.equal((0, inventory_js_1.canAccessLocation)({ role: 'BRANCH_MANAGER', assignedLocationIds: ['loc-1'] }, 'loc-1'), true);
    strict_1.default.equal((0, inventory_js_1.canAccessLocation)({ role: 'BRANCH_MANAGER', assignedLocationIds: ['loc-1'] }, 'loc-2'), false);
    strict_1.default.equal((0, inventory_js_1.canAccessLocation)({ role: 'STORE_USER', assignedLocationIds: ['loc-1'] }, 'loc-2'), false);
    strict_1.default.equal((0, inventory_js_1.canAccessLocation)({ role: 'STORE_USER', assignedLocationIds: ['loc-1'] }, 'loc-1'), true);
});
(0, node_test_1.default)('a company admin cannot access another company location even as ADMIN', () => {
    strict_1.default.equal((0, inventory_js_1.canAccessLocation)({ role: 'ADMIN', assignedLocationIds: [], companyId: 'default-company' }, 'loc-1'), true);
    strict_1.default.equal((0, inventory_js_1.canAccessLocation)({ role: 'ADMIN', assignedLocationIds: [], companyId: 'company-jaipur' }, 'loc-1'), false);
});
(0, node_test_1.default)('store users only receive physical quantities and never system stock values', () => {
    const sanitized = (0, inventory_js_1.sanitizeStockForRole)('STORE_USER', {
        itemId: 'item-1',
        locationId: 'loc-1',
        bookQuantity: 32,
        physicalQuantity: 28,
        variance: -4,
        stockValue: 1280,
    });
    strict_1.default.deepEqual(sanitized, {
        itemId: 'item-1',
        locationId: 'loc-1',
        physicalQuantity: 28,
    });
});
(0, node_test_1.default)('transfer status changes follow role-specific lifecycle rules', () => {
    strict_1.default.doesNotThrow(() => (0, inventory_js_1.validateTransferStatusChange)('ADMIN', 'CONFIRMED', 'DISPATCHED'));
    strict_1.default.doesNotThrow(() => (0, inventory_js_1.validateTransferStatusChange)('ADMIN', 'DISPATCHED', 'IN_TRANSIT'));
    strict_1.default.doesNotThrow(() => (0, inventory_js_1.validateTransferStatusChange)('WAREHOUSE_PICKER', 'REQUESTED', 'PICKED'));
    strict_1.default.throws(() => (0, inventory_js_1.validateTransferStatusChange)('AUDITOR', 'REQUESTED', 'DISPATCHED'));
    strict_1.default.throws(() => (0, inventory_js_1.validateTransferStatusChange)('STORE_USER', 'DISPATCHED', 'RECEIVED'));
    strict_1.default.throws(() => (0, inventory_js_1.validateTransferStatusChange)('ADMIN', 'REQUESTED', 'DISPATCHED'));
});
