"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const kg_pick_js_1 = require("./kg-pick.js");
const today = new Date('2026-09-19T00:00:00Z');
const lots = [
    { lotId: 'a', lotNo: 'A', available: 2, expiryDate: '2027-03-01' },
    { lotId: 'b', lotNo: 'B', available: 3, expiryDate: '2026-11-01' },
    { lotId: 'c', lotNo: 'C', available: 4, expiryDate: null },
];
(0, node_test_1.default)('FEFO takes the earliest expiry first, FIFO keeps the lot order; the picker never splits lots', () => {
    const fefo = (0, kg_pick_js_1.allocatePick)({ requested: 4, lots, strategy: 'FEFO', today });
    strict_1.default.deepEqual(fefo.allocations.map((row) => [row.lotNo, row.quantity]), [['B', 3], ['A', 1]]);
    strict_1.default.equal(fefo.shortfall, 0);
    const fifo = (0, kg_pick_js_1.allocatePick)({ requested: 4, lots, strategy: 'FIFO', today });
    strict_1.default.deepEqual(fifo.allocations.map((row) => [row.lotNo, row.quantity]), [['A', 2], ['B', 2]]);
});
(0, node_test_1.default)('blocked, expired, quarantined and empty lots are never offered', () => {
    const messy = [
        { lotId: 'x', lotNo: 'X', available: 5, status: 'BLOCKED' },
        { lotId: 'y', lotNo: 'Y', available: 5, expiryDate: '2026-09-01' },
        { lotId: 'z', lotNo: 'Z', available: 0 },
        { lotId: 'q', lotNo: 'Q', available: 5, status: 'QUARANTINE' },
        { lotId: 'ok', lotNo: 'OK', available: 1.5, expiryDate: '2026-09-19' },
    ];
    strict_1.default.deepEqual((0, kg_pick_js_1.allocatePick)({ requested: 1, lots: messy, strategy: 'FEFO', today }).allocations.map((row) => row.lotNo), ['OK']);
    strict_1.default.equal((0, kg_pick_js_1.isPickableLot)({ available: 5, expiryDate: '2026-09-18' }, today), false);
    strict_1.default.equal((0, kg_pick_js_1.isPickableLot)({ available: 5, expiryDate: '2026-09-19' }, today), true, 'a lot is good through its expiry day');
});
(0, node_test_1.default)('a request the shelf cannot cover reports the shortfall, decimals stay exact, and a bad quantity is refused', () => {
    const short = (0, kg_pick_js_1.allocatePick)({ requested: 10, lots, strategy: 'FEFO', today });
    strict_1.default.equal(short.allocations.reduce((sum, row) => sum + row.quantity, 0), 9);
    strict_1.default.equal(short.shortfall, 1);
    const decimals = (0, kg_pick_js_1.allocatePick)({ requested: 0.3, lots: [{ lotId: 'a', lotNo: 'A', available: 0.1 }, { lotId: 'b', lotNo: 'B', available: 0.2 }], strategy: 'FIFO', today });
    strict_1.default.deepEqual(decimals.allocations.map((row) => row.quantity), [0.1, 0.2]);
    strict_1.default.equal(decimals.shortfall, 0);
    strict_1.default.throws(() => (0, kg_pick_js_1.allocatePick)({ requested: 0, lots, strategy: 'FIFO' }), /greater than zero/);
    strict_1.default.throws(() => (0, kg_pick_js_1.allocatePick)({ requested: Number.NaN, lots, strategy: 'FIFO' }), /greater than zero/);
});
(0, node_test_1.default)('only pooled items are picked by weight from the whole shelf', () => {
    strict_1.default.equal((0, kg_pick_js_1.isPooledPick)({ pickMethod: 'ITEM_QTY_FIFO' }), true);
    strict_1.default.equal((0, kg_pick_js_1.isPooledPick)({ pickMethod: 'LOT_SCAN' }), false);
    strict_1.default.equal((0, kg_pick_js_1.isPooledPick)({}), false);
});
