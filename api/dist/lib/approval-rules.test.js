"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const approval_rules_js_1 = require("./approval-rules.js");
(0, node_test_1.default)('roleMeetsRequirement lets a higher-ranked role satisfy a lower requirement', () => {
    strict_1.default.equal((0, approval_rules_js_1.roleMeetsRequirement)('ADMIN', 'BRANCH_MANAGER'), true);
    strict_1.default.equal((0, approval_rules_js_1.roleMeetsRequirement)('BRANCH_MANAGER', 'BRANCH_MANAGER'), true);
    strict_1.default.equal((0, approval_rules_js_1.roleMeetsRequirement)('STORE_USER', 'BRANCH_MANAGER'), false);
    strict_1.default.equal((0, approval_rules_js_1.roleMeetsRequirement)('BRANCH_MANAGER', 'ADMIN'), false);
});
(0, node_test_1.default)('findTriggeredRule requires the threshold to actually be crossed', () => {
    const rule = { id: 'r1', category: null, branchId: null, valueThreshold: 100000, requiredApproverRole: 'BRANCH_MANAGER' };
    strict_1.default.equal((0, approval_rules_js_1.findTriggeredRule)([rule], { category: null, branchId: null, value: 100000 })?.id, 'r1');
    strict_1.default.equal((0, approval_rules_js_1.findTriggeredRule)([rule], { category: null, branchId: null, value: 99999 }), null);
});
(0, node_test_1.default)('findTriggeredRule prefers a branch-specific rule over a global one', () => {
    const global = { id: 'global', category: null, branchId: null, valueThreshold: 100000, requiredApproverRole: 'BRANCH_MANAGER' };
    const branchSpecific = { id: 'branch', category: null, branchId: 'branch-1', valueThreshold: 100000, requiredApproverRole: 'ADMIN' };
    const matched = (0, approval_rules_js_1.findTriggeredRule)([global, branchSpecific], { category: null, branchId: 'branch-1', value: 150000 });
    strict_1.default.equal(matched?.id, 'branch');
});
(0, node_test_1.default)('findTriggeredRule ignores a branch-scoped rule for a different branch', () => {
    const branchSpecific = { id: 'branch', category: null, branchId: 'branch-1', valueThreshold: 100000, requiredApproverRole: 'ADMIN' };
    strict_1.default.equal((0, approval_rules_js_1.findTriggeredRule)([branchSpecific], { category: null, branchId: 'branch-2', value: 150000 }), null);
});
(0, node_test_1.default)('findTriggeredRule ignores a category-scoped rule for a different category', () => {
    const categorySpecific = { id: 'electronics', category: 'Electronics', branchId: null, valueThreshold: 50000, requiredApproverRole: 'ADMIN' };
    strict_1.default.equal((0, approval_rules_js_1.findTriggeredRule)([categorySpecific], { category: 'Dairy', branchId: null, value: 60000 }), null);
    strict_1.default.equal((0, approval_rules_js_1.findTriggeredRule)([categorySpecific], { category: 'Electronics', branchId: null, value: 60000 })?.id, 'electronics');
});
(0, node_test_1.default)('findTriggeredRule prefers a category+branch rule over a category-only or global one', () => {
    const global = { id: 'global', category: null, branchId: null, valueThreshold: 10000, requiredApproverRole: 'BRANCH_MANAGER' };
    const categoryOnly = { id: 'category', category: 'Electronics', branchId: null, valueThreshold: 10000, requiredApproverRole: 'BRANCH_MANAGER' };
    const both = { id: 'both', category: 'Electronics', branchId: 'branch-1', valueThreshold: 10000, requiredApproverRole: 'ADMIN' };
    const matched = (0, approval_rules_js_1.findTriggeredRule)([global, categoryOnly, both], { category: 'Electronics', branchId: 'branch-1', value: 20000 });
    strict_1.default.equal(matched?.id, 'both');
});
