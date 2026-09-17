"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const price_guardrails_js_1 = require("./price-guardrails.js");
(0, node_test_1.default)('a price within MRP, above cost and above minimum margin is ok', () => {
    const result = (0, price_guardrails_js_1.validatePrice)({ proposedPrice: 150, mrp: 200, landedCost: 100, minMarginPercent: 20 });
    strict_1.default.equal(result.ok, true);
    strict_1.default.equal(result.violations.length, 0);
});
(0, node_test_1.default)('a price above MRP is blocked', () => {
    const result = (0, price_guardrails_js_1.validatePrice)({ proposedPrice: 250, mrp: 200 });
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.violations[0].code, 'ABOVE_MRP');
    strict_1.default.equal(result.violations[0].severity, 'BLOCK');
});
(0, node_test_1.default)('a price below landed cost is blocked - never publish a guaranteed loss', () => {
    const result = (0, price_guardrails_js_1.validatePrice)({ proposedPrice: 80, landedCost: 100 });
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.violations[0].code, 'BELOW_COST');
});
(0, node_test_1.default)('a price above cost but below minimum margin is a warning, not a block', () => {
    const result = (0, price_guardrails_js_1.validatePrice)({ proposedPrice: 105, landedCost: 100, minMarginPercent: 20 });
    strict_1.default.equal(result.ok, true, 'a WARN-only violation must not flip ok to false');
    strict_1.default.equal(result.violations[0].code, 'BELOW_MIN_MARGIN');
    strict_1.default.equal(result.violations[0].severity, 'WARN');
});
(0, node_test_1.default)('margin percent is computed and returned even when it clears the minimum', () => {
    const result = (0, price_guardrails_js_1.validatePrice)({ proposedPrice: 200, landedCost: 100, minMarginPercent: 20 });
    strict_1.default.equal(result.marginPercent, 50);
    strict_1.default.equal(result.violations.length, 0);
});
(0, node_test_1.default)('an effective end date on or before the start date is blocked', () => {
    const result = (0, price_guardrails_js_1.validatePrice)({
        proposedPrice: 100,
        effectiveFrom: '2026-09-20T00:00:00.000Z',
        effectiveTo: '2026-09-10T00:00:00.000Z',
    });
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.violations[0].code, 'INVALID_EFFECTIVE_DATE');
});
(0, node_test_1.default)('no cost/MRP/margin inputs at all means nothing to violate', () => {
    const result = (0, price_guardrails_js_1.validatePrice)({ proposedPrice: 100 });
    strict_1.default.equal(result.ok, true);
    strict_1.default.equal(result.marginPercent, null);
});
(0, node_test_1.default)('multiple violations are all reported together, not just the first', () => {
    const result = (0, price_guardrails_js_1.validatePrice)({ proposedPrice: 250, mrp: 200, landedCost: 260 });
    const codes = result.violations.map((violation) => violation.code).sort();
    strict_1.default.deepEqual(codes, ['ABOVE_MRP', 'BELOW_COST']);
});
