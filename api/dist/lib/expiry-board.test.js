"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const expiry_board_js_1 = require("./expiry-board.js");
const now = new Date('2026-09-13T10:00:00');
(0, node_test_1.default)('calendar expiry uses local start-of-day and missing dates stay null', () => {
    strict_1.default.equal((0, expiry_board_js_1.calendarDaysUntilExpiry)(null, now), null);
    strict_1.default.equal((0, expiry_board_js_1.calendarDaysUntilExpiry)('2026-09-13', now), 0);
    strict_1.default.equal((0, expiry_board_js_1.calendarDaysUntilExpiry)('2026-09-20', now), 7);
    strict_1.default.equal((0, expiry_board_js_1.calendarDaysUntilExpiry)('2026-09-12', now), -1);
});
(0, node_test_1.default)('horizon and recommended FEFO actions cover the full grocery queue', () => {
    strict_1.default.equal((0, expiry_board_js_1.classifyExpiryHorizon)(null), 'MISSING');
    strict_1.default.equal((0, expiry_board_js_1.classifyExpiryHorizon)(-1), 'EXPIRED');
    strict_1.default.equal((0, expiry_board_js_1.classifyExpiryHorizon)(7), 'CRITICAL');
    strict_1.default.equal((0, expiry_board_js_1.classifyExpiryHorizon)(30), 'WARNING');
    strict_1.default.equal((0, expiry_board_js_1.classifyExpiryHorizon)(90), 'UPCOMING');
    strict_1.default.equal((0, expiry_board_js_1.classifyExpiryHorizon)(91), 'DATED');
    strict_1.default.match((0, expiry_board_js_1.recommendedExpiryActionForHorizon)('EXPIRED'), /write-off/);
    strict_1.default.match((0, expiry_board_js_1.recommendedExpiryActionForHorizon)('MISSING'), /expiry date/);
    strict_1.default.equal((0, expiry_board_js_1.matchesExpiryHorizon)('MISSING', 'action'), true);
    strict_1.default.equal((0, expiry_board_js_1.matchesExpiryHorizon)('DATED', 'action'), false);
    strict_1.default.equal((0, expiry_board_js_1.matchesExpiryHorizon)('UPCOMING', 'risk'), true);
});
(0, node_test_1.default)('lot value prefers purchase closing value then rate', () => {
    strict_1.default.equal((0, expiry_board_js_1.estimateLotValue)({ purchaseValue: 120 }, 4), 120);
    strict_1.default.equal((0, expiry_board_js_1.estimateLotValue)({ purchaseRate: 10 }, 4), 40);
    strict_1.default.equal((0, expiry_board_js_1.estimateLotValue)({ saleValue: 80 }, 2), 80);
    strict_1.default.equal((0, expiry_board_js_1.estimateLotValue)({}, 2), null);
});
(0, node_test_1.default)('expiry board includes missing dates and ranks expired lots first', () => {
    const board = (0, expiry_board_js_1.buildExpiryBoard)({
        now,
        items: [
            { id: 'i1', code: 'RICE', name: 'Rice', category: 'Staples', unit: 'KG' },
            { id: 'i2', code: 'MILK', name: 'Milk', category: 'Dairy', unit: 'PCS' },
        ],
        lots: [
            { id: 'l-expired', lotNo: 'E1', expiryDate: '2026-09-01', attributes: { purchaseValue: 400 } },
            { id: 'l-soon', lotNo: 'S1', expiryDate: '2026-09-16', attributes: { purchaseValue: 90 } },
            { id: 'l-safe', lotNo: 'F1', expiryDate: '2027-04-01' },
            { id: 'l-missing', lotNo: 'M1', expiryDate: null },
        ],
        stock: [
            { itemId: 'i1', lotId: 'l-expired', locationId: 'loc-1', quantity: 12 },
            { itemId: 'i2', lotId: 'l-soon', locationId: 'loc-1', quantity: 6 },
            { itemId: 'i1', lotId: 'l-safe', locationId: 'loc-1', quantity: 40 },
            { itemId: 'i2', lotId: 'l-missing', locationId: 'loc-1', quantity: 8 },
            { itemId: 'i2', lotId: 'l-soon', locationId: 'loc-1', quantity: 0 },
        ],
    });
    strict_1.default.equal(board.lots.length, 4);
    strict_1.default.equal(board.lots[0].horizon, 'EXPIRED');
    strict_1.default.equal(board.lots[0].quantity, 12);
    strict_1.default.equal(board.summary.expiredLots, 1);
    strict_1.default.equal(board.summary.expiredQty, 12);
    strict_1.default.equal(board.summary.expiredValue, 400);
    strict_1.default.equal(board.summary.criticalLots, 1);
    strict_1.default.equal(board.summary.missingLots, 1);
    strict_1.default.equal(board.summary.missingQty, 8);
    strict_1.default.equal(board.summary.datedOnHandLots, 3);
    strict_1.default.equal(board.summary.atRiskLots, 2);
    strict_1.default.deepEqual(board.categories, ['Dairy', 'Staples']);
    strict_1.default.equal((0, expiry_board_js_1.emptyExpiryBoard)().lots.length, 0);
});
