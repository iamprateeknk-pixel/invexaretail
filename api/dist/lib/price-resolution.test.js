"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const price_resolution_js_1 = require("./price-resolution.js");
function row(overrides) {
    return {
        id: overrides.id ?? 'p1',
        price: overrides.price ?? 100,
        branchId: overrides.branchId ?? null,
        customerGroup: overrides.customerGroup ?? null,
        effectiveFrom: overrides.effectiveFrom ?? '2026-01-01T00:00:00.000Z',
        effectiveTo: overrides.effectiveTo ?? null,
        status: overrides.status ?? 'ACTIVE',
    };
}
(0, node_test_1.default)('a company-wide price applies when nothing more specific exists', () => {
    const result = (0, price_resolution_js_1.resolvePrice)([row({ price: 100 })], {});
    strict_1.default.equal(result?.price, 100);
});
(0, node_test_1.default)('a branch-specific price wins over the company-wide price at that branch', () => {
    const candidates = [row({ id: 'wide', price: 100 }), row({ id: 'branch', price: 90, branchId: 'jaipur' })];
    const result = (0, price_resolution_js_1.resolvePrice)(candidates, { branchId: 'jaipur' });
    strict_1.default.equal(result?.id, 'branch');
});
(0, node_test_1.default)('a branch-specific price never applies to a different branch', () => {
    const candidates = [row({ id: 'wide', price: 100 }), row({ id: 'branch', price: 90, branchId: 'jaipur' })];
    const result = (0, price_resolution_js_1.resolvePrice)(candidates, { branchId: 'basni' });
    strict_1.default.equal(result?.id, 'wide');
});
(0, node_test_1.default)('branch + customer-group match beats either alone', () => {
    const candidates = [
        row({ id: 'wide', price: 100 }),
        row({ id: 'branch', price: 90, branchId: 'jaipur' }),
        row({ id: 'group', price: 85, customerGroup: 'wholesale' }),
        row({ id: 'both', price: 80, branchId: 'jaipur', customerGroup: 'wholesale' }),
    ];
    const result = (0, price_resolution_js_1.resolvePrice)(candidates, { branchId: 'jaipur', customerGroup: 'wholesale' });
    strict_1.default.equal(result?.id, 'both');
});
(0, node_test_1.default)('a price outside its effective date range is ignored', () => {
    const candidates = [
        row({ id: 'expired', price: 50, effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: '2020-06-01T00:00:00.000Z' }),
        row({ id: 'current', price: 100 }),
    ];
    const result = (0, price_resolution_js_1.resolvePrice)(candidates, { at: '2026-06-01T00:00:00.000Z' });
    strict_1.default.equal(result?.id, 'current');
});
(0, node_test_1.default)('a future-dated price does not apply yet', () => {
    const candidates = [row({ id: 'future', price: 999, effectiveFrom: '2099-01-01T00:00:00.000Z' })];
    const result = (0, price_resolution_js_1.resolvePrice)(candidates, { at: '2026-06-01T00:00:00.000Z' });
    strict_1.default.equal(result, null);
});
(0, node_test_1.default)('an INACTIVE row is never resolved', () => {
    const result = (0, price_resolution_js_1.resolvePrice)([row({ status: 'INACTIVE' })], {});
    strict_1.default.equal(result, null);
});
(0, node_test_1.default)('between two currently-effective rows of equal specificity, the more recently effective one wins', () => {
    const candidates = [
        row({ id: 'old', price: 100, effectiveFrom: '2026-01-01T00:00:00.000Z' }),
        row({ id: 'new', price: 110, effectiveFrom: '2026-03-01T00:00:00.000Z' }),
    ];
    const result = (0, price_resolution_js_1.resolvePrice)(candidates, { at: '2026-06-01T00:00:00.000Z' });
    strict_1.default.equal(result?.id, 'new');
});
(0, node_test_1.default)('no candidates at all resolves to null, not a thrown error', () => {
    strict_1.default.equal((0, price_resolution_js_1.resolvePrice)([], {}), null);
});
