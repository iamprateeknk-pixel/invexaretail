"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const count_tolerance_js_1 = require("./count-tolerance.js");
function rule(overrides) {
    return { id: 'r1', label: 'Rule', category: null, branchId: null, valueThreshold: null, percentThreshold: null, ...overrides };
}
(0, node_test_1.default)('ruleTriggers requires both scope match and a crossed threshold', () => {
    const r = rule({ category: 'Dairy', valueThreshold: 5000 });
    strict_1.default.equal((0, count_tolerance_js_1.ruleTriggers)(r, { category: 'Dairy', branchId: null, variancePercent: 0, varianceValue: 6000 }), true);
    strict_1.default.equal((0, count_tolerance_js_1.ruleTriggers)(r, { category: 'Bakery', branchId: null, variancePercent: 0, varianceValue: 6000 }), false, 'category mismatch');
    strict_1.default.equal((0, count_tolerance_js_1.ruleTriggers)(r, { category: 'Dairy', branchId: null, variancePercent: 0, varianceValue: 4000 }), false, 'below threshold');
});
(0, node_test_1.default)('ruleTriggers treats a null category/branch on the rule as applying to everything', () => {
    const r = rule({ percentThreshold: 2 });
    strict_1.default.equal((0, count_tolerance_js_1.ruleTriggers)(r, { category: 'Anything', branchId: 'branch-1', variancePercent: 3, varianceValue: 0 }), true);
});
(0, node_test_1.default)('evaluateTolerance prefers the most specific matching rule', () => {
    const global = rule({ id: 'global', valueThreshold: 1000 });
    const categoryOnly = rule({ id: 'category', category: 'Dairy', valueThreshold: 1000 });
    const categoryAndBranch = rule({ id: 'both', category: 'Dairy', branchId: 'branch-1', valueThreshold: 1000 });
    const matched = (0, count_tolerance_js_1.evaluateTolerance)([global, categoryOnly, categoryAndBranch], { category: 'Dairy', branchId: 'branch-1', variancePercent: 0, varianceValue: 2000 });
    strict_1.default.equal(matched?.id, 'both');
});
(0, node_test_1.default)('evaluateTolerance returns null when nothing triggers', () => {
    const r = rule({ valueThreshold: 100000 });
    strict_1.default.equal((0, count_tolerance_js_1.evaluateTolerance)([r], { category: null, branchId: null, variancePercent: 1, varianceValue: 50 }), null);
});
