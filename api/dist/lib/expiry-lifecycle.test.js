"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const expiry_lifecycle_js_1 = require("./expiry-lifecycle.js");
const repository_js_1 = require("./repository.js");
const now = new Date('2026-09-14T12:00:00');
(0, node_test_1.default)('expiry board surfaces expired, critical and missing-date lots', () => {
    const board = (0, expiry_lifecycle_js_1.buildLocationExpiryBoard)('loc-1', now);
    const horizons = new Map(board.lots.map((lot) => [lot.lotNo, lot.horizon]));
    strict_1.default.equal(horizons.get('LOT-EXP'), 'EXPIRED');
    strict_1.default.equal(horizons.get('LOT-SOON'), 'CRITICAL');
    strict_1.default.equal(horizons.get('LOT-ND'), 'MISSING');
    strict_1.default.ok(board.summary.expiredLots >= 1);
    strict_1.default.ok(board.summary.missingLots >= 1);
    strict_1.default.ok(board.summary.criticalLots >= 1);
});
(0, node_test_1.default)('expiry alerts rank soonest dated lots first and skip missing dates', () => {
    const alerts = (0, expiry_lifecycle_js_1.listLocationExpiryAlerts)('loc-1', now);
    strict_1.default.ok(alerts.some((alert) => alert.lot.lotNo === 'LOT-EXP'));
    strict_1.default.ok(!alerts.some((alert) => alert.lot.lotNo === 'LOT-ND'));
    strict_1.default.ok(alerts[0].daysUntilExpiry <= alerts[alerts.length - 1].daysUntilExpiry);
});
(0, node_test_1.default)('write-off deducts stock and records an EXPIRY_WRITE_OFF movement', () => {
    const before = (0, repository_js_1.findStockLedgerEntry)('item-1004', 'lot-1004', 'loc-1').onHand;
    const result = (0, expiry_lifecycle_js_1.writeOffExpiryLot)({
        itemId: 'item-1004',
        lotId: 'lot-1004',
        locationId: 'loc-1',
        quantity: 2,
        reason: 'Expired yoghurt verified and discarded',
        actorId: 'user-admin-1',
        role: 'ADMIN',
    });
    strict_1.default.equal(result.quantity, 2);
    strict_1.default.equal(result.afterBalance, before - 2);
    strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-1004', 'lot-1004', 'loc-1').onHand, before - 2);
    (0, repository_js_1.adjustStockLedger)('item-1004', 'lot-1004', 'loc-1', 2);
    (0, repository_js_1.updateLotStatus)('lot-1004', 'AVAILABLE');
});
(0, node_test_1.default)('write-off rejects store users, short reasons and over-quantity', () => {
    strict_1.default.throws(() => (0, expiry_lifecycle_js_1.writeOffExpiryLot)({
        itemId: 'item-1004', lotId: 'lot-1004', locationId: 'loc-1', quantity: 1, reason: 'Expired yoghurt verified', actorId: 'user-store-1', role: 'STORE_USER',
    }), (error) => error instanceof expiry_lifecycle_js_1.ExpiryWriteOffError && error.status === 403);
    strict_1.default.throws(() => (0, expiry_lifecycle_js_1.writeOffExpiryLot)({
        itemId: 'item-1004', lotId: 'lot-1004', locationId: 'loc-1', quantity: 1, reason: 'no', actorId: 'user-admin-1', role: 'ADMIN',
    }), (error) => error instanceof expiry_lifecycle_js_1.ExpiryWriteOffError && error.status === 400);
    strict_1.default.throws(() => (0, expiry_lifecycle_js_1.writeOffExpiryLot)({
        itemId: 'item-1004', lotId: 'lot-1004', locationId: 'loc-1', quantity: 999, reason: 'Expired yoghurt verified', actorId: 'user-admin-1', role: 'ADMIN',
    }), /exceeds current lot stock/);
});
(0, node_test_1.default)('lot expiry and sale status can be repaired in memory', () => {
    const dated = (0, expiry_lifecycle_js_1.setLotExpiryDate)('lot-1006', '2026-10-01');
    strict_1.default.ok(dated.expiryDate);
    const missing = (0, expiry_lifecycle_js_1.setLotExpiryDate)('lot-1006', null);
    strict_1.default.equal(missing.expiryDate, null);
    const blocked = (0, expiry_lifecycle_js_1.setLotSaleStatus)('lot-1005', 'BLOCKED');
    strict_1.default.equal(blocked.status, 'BLOCKED');
    (0, repository_js_1.updateLotStatus)('lot-1005', 'AVAILABLE');
    (0, repository_js_1.updateLotExpiry)('lot-1006', null);
});
