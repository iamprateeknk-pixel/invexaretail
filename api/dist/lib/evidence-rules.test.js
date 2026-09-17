"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const evidence_rules_js_1 = require("./evidence-rules.js");
(0, node_test_1.default)('ruleTriggers matches scope and either independent threshold', () => {
    const quantityRule = { id: 'q1', label: 'Qty', category: null, branchId: null, quantityThreshold: 5, valueThreshold: null };
    strict_1.default.equal((0, evidence_rules_js_1.ruleTriggers)(quantityRule, { category: null, branchId: null, quantity: 5, value: 0 }), true);
    strict_1.default.equal((0, evidence_rules_js_1.ruleTriggers)(quantityRule, { category: null, branchId: null, quantity: 4, value: 999999 }), false);
    const valueRule = { id: 'v1', label: 'Value', category: null, branchId: null, quantityThreshold: null, valueThreshold: 10000 };
    strict_1.default.equal((0, evidence_rules_js_1.ruleTriggers)(valueRule, { category: null, branchId: null, quantity: 0, value: 10000 }), true);
    strict_1.default.equal((0, evidence_rules_js_1.ruleTriggers)(valueRule, { category: null, branchId: null, quantity: 999, value: 9999 }), false);
});
(0, node_test_1.default)('ruleTriggers ignores a category-scoped rule for a different category', () => {
    const rule = { id: 'e1', label: 'Electronics', category: 'Electronics', branchId: null, quantityThreshold: 1, valueThreshold: null };
    strict_1.default.equal((0, evidence_rules_js_1.ruleTriggers)(rule, { category: 'Dairy', branchId: null, quantity: 5, value: 0 }), false);
    strict_1.default.equal((0, evidence_rules_js_1.ruleTriggers)(rule, { category: 'Electronics', branchId: null, quantity: 5, value: 0 }), true);
});
(0, node_test_1.default)('ruleTriggers ignores a branch-scoped rule for a different branch', () => {
    const rule = { id: 'b1', label: 'Branch', category: null, branchId: 'branch-1', quantityThreshold: 1, valueThreshold: null };
    strict_1.default.equal((0, evidence_rules_js_1.ruleTriggers)(rule, { category: null, branchId: 'branch-2', quantity: 5, value: 0 }), false);
    strict_1.default.equal((0, evidence_rules_js_1.ruleTriggers)(rule, { category: null, branchId: 'branch-1', quantity: 5, value: 0 }), true);
});
(0, node_test_1.default)('findTriggeredEvidenceRule prefers the most specific matching, triggered rule', () => {
    const global = { id: 'global', label: 'Global', category: null, branchId: null, quantityThreshold: 1, valueThreshold: null };
    const categoryOnly = { id: 'category', label: 'Category', category: 'Electronics', branchId: null, quantityThreshold: 1, valueThreshold: null };
    const both = { id: 'both', label: 'Both', category: 'Electronics', branchId: 'branch-1', quantityThreshold: 1, valueThreshold: null };
    const matched = (0, evidence_rules_js_1.findTriggeredEvidenceRule)([global, categoryOnly, both], { category: 'Electronics', branchId: 'branch-1', quantity: 5, value: 0 });
    strict_1.default.equal(matched?.id, 'both');
});
(0, node_test_1.default)('findTriggeredEvidenceRule returns null when nothing triggers', () => {
    const rule = { id: 'r1', label: 'R', category: null, branchId: null, quantityThreshold: 100, valueThreshold: null };
    strict_1.default.equal((0, evidence_rules_js_1.findTriggeredEvidenceRule)([rule], { category: null, branchId: null, quantity: 1, value: 0 }), null);
});
