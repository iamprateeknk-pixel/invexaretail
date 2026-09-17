"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const vendor_score_js_1 = require("./vendor-score.js");
(0, node_test_1.default)('no orders yields a zeroed score, not a crash', () => {
    const result = (0, vendor_score_js_1.computeVendorScore)([]);
    strict_1.default.equal(result.ordersConsidered, 0);
    strict_1.default.equal(result.fillRatePercent, 0);
    strict_1.default.equal(result.averageLeadTimeDays, null);
});
(0, node_test_1.default)('fill rate is total received over total ordered across all orders', () => {
    const result = (0, vendor_score_js_1.computeVendorScore)([
        { quantity: 100, receivedQty: 100, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
        { quantity: 100, receivedQty: 50, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    strict_1.default.equal(result.fillRatePercent, 75);
});
(0, node_test_1.default)('an over-receipt does not inflate fill rate above 100%, and is flagged as excess', () => {
    const result = (0, vendor_score_js_1.computeVendorScore)([
        { quantity: 100, receivedQty: 120, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    strict_1.default.equal(result.fillRatePercent, 100);
    strict_1.default.equal(result.excessReceiptCount, 1);
    strict_1.default.equal(result.shortReceiptCount, 0);
});
(0, node_test_1.default)('a short receipt is flagged separately from an excess one', () => {
    const result = (0, vendor_score_js_1.computeVendorScore)([
        { quantity: 100, receivedQty: 80, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    strict_1.default.equal(result.shortReceiptCount, 1);
    strict_1.default.equal(result.excessReceiptCount, 0);
});
(0, node_test_1.default)('on-time delivery only counts orders with both an expected and an actual completion date', () => {
    const result = (0, vendor_score_js_1.computeVendorScore)([
        { quantity: 10, receivedQty: 10, expectedAt: '2026-01-10T00:00:00.000Z', completedAt: '2026-01-09T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }, // on time
        { quantity: 10, receivedQty: 10, expectedAt: '2026-01-10T00:00:00.000Z', completedAt: '2026-01-12T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }, // late
        { quantity: 10, receivedQty: 0, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }, // still open, excluded
    ]);
    strict_1.default.equal(result.onTimeDeliveryPercent, 50);
});
(0, node_test_1.default)('average lead time is computed only over completed orders', () => {
    const result = (0, vendor_score_js_1.computeVendorScore)([
        { quantity: 10, receivedQty: 10, expectedAt: null, completedAt: '2026-01-05T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
        { quantity: 10, receivedQty: 10, expectedAt: null, completedAt: '2026-01-11T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    strict_1.default.equal(result.averageLeadTimeDays, 7);
});
(0, node_test_1.default)('quality reject rate is passed through from inspection results when provided', () => {
    const result = (0, vendor_score_js_1.computeVendorScore)([{ quantity: 10, receivedQty: 10, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }], { totalInspections: 4, failedInspections: 1 });
    strict_1.default.equal(result.qualityRejectRatePercent, 25);
});
(0, node_test_1.default)('price variance is null with fewer than two price points', () => {
    strict_1.default.equal((0, vendor_score_js_1.computePriceVariance)([]), null);
    strict_1.default.equal((0, vendor_score_js_1.computePriceVariance)([{ unitCost: 10, at: '2026-01-01T00:00:00.000Z' }]), null);
});
(0, node_test_1.default)('price variance compares the earliest and latest price, sorted by date regardless of input order', () => {
    const result = (0, vendor_score_js_1.computePriceVariance)([
        { unitCost: 12, at: '2026-03-01T00:00:00.000Z' },
        { unitCost: 10, at: '2026-01-01T00:00:00.000Z' },
    ]);
    strict_1.default.equal(result?.earliest, 10);
    strict_1.default.equal(result?.latest, 12);
    strict_1.default.equal(result?.variancePercent, 20);
});
