"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const weight_allocation_js_1 = require("./weight-allocation.js");
const lot = (id, bookQty, over = {}) => ({ lotId: id, lotNo: `LOT-${id}`, bookQty, ...over });
(0, node_test_1.default)('the blueprint example: book 2+2+2, counted 5 -> 2+2+1 and variance -1', () => {
    const allocation = (0, weight_allocation_js_1.allocateWeightCount)(5, [lot('a', 2), lot('b', 2), lot('c', 2)], 'FIFO');
    strict_1.default.deepEqual(allocation.map((row) => row.physicalQty), [2, 2, 1]);
    strict_1.default.equal((0, weight_allocation_js_1.totalVariance)(allocation), -1);
});
(0, node_test_1.default)('FEFO fills the earliest-expiring lots first; lots with no expiry go last', () => {
    const lots = [lot('late', 2, { expiryDate: '2027-03-01' }), lot('none', 2), lot('soon', 2, { expiryDate: '2026-10-01' })];
    const allocation = (0, weight_allocation_js_1.allocateWeightCount)(3, lots, 'FEFO');
    strict_1.default.deepEqual(allocation.map((row) => [row.lotId, row.physicalQty]), [['soon', 2], ['late', 1], ['none', 0]]);
    // FIFO ignores expiry and keeps creation order.
    strict_1.default.deepEqual((0, weight_allocation_js_1.allocateWeightCount)(3, lots, 'FIFO').map((row) => row.lotId), ['late', 'none', 'soon']);
});
(0, node_test_1.default)('a count above the book total puts the excess on the last lot, so the variance shows it', () => {
    const allocation = (0, weight_allocation_js_1.allocateWeightCount)(7.5, [lot('a', 2), lot('b', 2), lot('c', 2)], 'FIFO');
    strict_1.default.deepEqual(allocation.map((row) => row.physicalQty), [2, 2, 3.5]);
    strict_1.default.equal((0, weight_allocation_js_1.totalVariance)(allocation), 1.5);
});
(0, node_test_1.default)('decimals are exact and the same input always gives the same split', () => {
    const lots = [lot('a', 0.1), lot('b', 0.2), lot('c', 0.3)];
    const first = (0, weight_allocation_js_1.allocateWeightCount)(0.35, lots, 'FIFO');
    strict_1.default.deepEqual(first.map((row) => row.physicalQty), [0.1, 0.2, 0.05]);
    strict_1.default.deepEqual((0, weight_allocation_js_1.allocateWeightCount)(0.35, [...lots], 'FIFO'), first);
    strict_1.default.equal((0, weight_allocation_js_1.totalVariance)(first), -0.25);
    // Zero counted is a valid count: every lot is short.
    strict_1.default.deepEqual((0, weight_allocation_js_1.allocateWeightCount)(0, lots, 'FIFO').map((row) => row.physicalQty), [0, 0, 0]);
});
(0, node_test_1.default)('zero-stock, blocked, expired and quarantined lots never take part', () => {
    const lots = [lot('zero', 0), lot('blocked', 5, { status: 'BLOCKED' }), lot('expired', 5, { status: 'EXPIRED' }), lot('quar', 5, { status: 'QUARANTINE' }), lot('ok', 4)];
    const allocation = (0, weight_allocation_js_1.allocateWeightCount)(3, lots, 'FEFO');
    strict_1.default.deepEqual(allocation.map((row) => row.lotId), ['ok']);
    strict_1.default.throws(() => (0, weight_allocation_js_1.allocateWeightCount)(3, [lot('zero', 0), lot('blocked', 5, { status: 'BLOCKED' })], 'FEFO'), /no counted-in lots/);
});
(0, node_test_1.default)('bad totals are rejected', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY])
        strict_1.default.throws(() => (0, weight_allocation_js_1.allocateWeightCount)(bad, [lot('a', 1)], 'FIFO'), /non-negative/);
    strict_1.default.deepEqual((0, weight_allocation_js_1.orderLots)([], 'FEFO'), []);
});
