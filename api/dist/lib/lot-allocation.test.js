"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const lot_allocation_js_1 = require("./lot-allocation.js");
(0, node_test_1.default)('FIFO allocates a 5kg item count over three 2kg lots as 2 + 2 + 1', () => {
    const result = (0, lot_allocation_js_1.allocatePhysicalAcrossLots)({
        physicalQty: 5,
        strategy: 'FIFO',
        lots: [
            { lotId: 'lot-1', onHand: 2, receivedAt: '2026-09-01T10:00:00Z' },
            { lotId: 'lot-2', onHand: 2, receivedAt: '2026-09-02T10:00:00Z' },
            { lotId: 'lot-3', onHand: 2, receivedAt: '2026-09-03T10:00:00Z' },
        ],
    });
    strict_1.default.deepEqual(result.allocations.map((row) => row.physicalQty), [2, 2, 1]);
    strict_1.default.deepEqual(result.allocations.map((row) => row.variance), [0, 0, -1]);
    strict_1.default.equal(result.totalBookQty, 6);
    strict_1.default.equal(result.physicalQty, 5);
    strict_1.default.equal(result.totalVariance, -1);
    strict_1.default.equal(result.excessQty, 0);
});
(0, node_test_1.default)('quantity above book stock is surfaced as excess instead of creating a fake negative/overflow lot', () => {
    const result = (0, lot_allocation_js_1.allocatePhysicalAcrossLots)({
        physicalQty: 7,
        lots: [
            { lotId: 'lot-1', onHand: 2 },
            { lotId: 'lot-2', onHand: 2 },
            { lotId: 'lot-3', onHand: 2 },
        ],
    });
    strict_1.default.deepEqual(result.allocations.map((row) => row.physicalQty), [2, 2, 2]);
    strict_1.default.equal(result.allocatedQty, 6);
    strict_1.default.equal(result.excessQty, 1);
    strict_1.default.equal(result.totalVariance, 1);
});
(0, node_test_1.default)('FEFO consumes the earliest-expiring lot first', () => {
    const result = (0, lot_allocation_js_1.allocatePhysicalAcrossLots)({
        physicalQty: 3,
        strategy: 'FEFO',
        lots: [
            { lotId: 'late', onHand: 2, expiryDate: '2027-06-01' },
            { lotId: 'early', onHand: 2, expiryDate: '2026-10-01' },
        ],
    });
    strict_1.default.deepEqual(result.allocations.map((row) => row.lotId), ['early', 'late']);
    strict_1.default.deepEqual(result.allocations.map((row) => row.physicalQty), [2, 1]);
});
(0, node_test_1.default)('decimal KG quantities respect configured precision', () => {
    const result = (0, lot_allocation_js_1.allocatePhysicalAcrossLots)({
        physicalQty: 4.375,
        precision: 3,
        lots: [
            { lotId: 'a', onHand: 2.125 },
            { lotId: 'b', onHand: 3.25 },
        ],
    });
    strict_1.default.deepEqual(result.allocations.map((row) => row.physicalQty), [2.125, 2.25]);
    strict_1.default.equal(result.totalVariance, -1);
});
