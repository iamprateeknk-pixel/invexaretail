"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const stock_ledger_js_1 = require("./stock-ledger.js");
(0, node_test_1.default)('posting a movement updates balance and records before/after', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
    const movement = ledger.postMovement({
        ...key,
        movementType: 'OPENING_STOCK',
        qtyDelta: 50,
        actor: 'admin',
    });
    strict_1.default.equal(movement.beforeBalance, 0);
    strict_1.default.equal(movement.afterBalance, 50);
    strict_1.default.equal(ledger.getBalance(key).onHand, 50);
});
(0, node_test_1.default)('current stock equals sum of posted movements', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
    ledger.postMovement({ ...key, movementType: 'OPENING_STOCK', qtyDelta: 100, actor: 'admin' });
    ledger.postMovement({ ...key, movementType: 'SALES_DEDUCTION', qtyDelta: -30, actor: 'sync' });
    ledger.postMovement({ ...key, movementType: 'PURCHASE_RECEIPT', qtyDelta: 20, actor: 'sync' });
    strict_1.default.equal(ledger.getBalance(key).onHand, 90);
    strict_1.default.equal(ledger.recomputeBalanceFromMovements(key), 90);
});
(0, node_test_1.default)('negative stock is blocked by default policy', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
    ledger.postMovement({ ...key, movementType: 'OPENING_STOCK', qtyDelta: 10, actor: 'admin' });
    strict_1.default.throws(() => ledger.postMovement({
        ...key,
        movementType: 'SALES_DEDUCTION',
        qtyDelta: -15,
        actor: 'sync',
    }), stock_ledger_js_1.NegativeStockBlockedError);
    // Balance is unchanged after the blocked attempt.
    strict_1.default.equal(ledger.getBalance(key).onHand, 10);
});
(0, node_test_1.default)('ALLOW policy permits negative stock through', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
    ledger.postMovement({ ...key, movementType: 'OPENING_STOCK', qtyDelta: 5, actor: 'admin' });
    const movement = ledger.postMovement({
        ...key,
        movementType: 'SALES_DEDUCTION',
        qtyDelta: -8,
        actor: 'sync',
        negativeStockPolicy: 'ALLOW',
    });
    strict_1.default.equal(movement.afterBalance, -3);
    strict_1.default.equal(ledger.getBalance(key).onHand, -3);
});
(0, node_test_1.default)('posted movements are never mutated; corrections use reversal + replacement', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
    const original = ledger.postMovement({
        ...key,
        movementType: 'ADJUSTMENT',
        qtyDelta: 40,
        actor: 'admin',
    });
    const reversal = ledger.reverseMovement(original.id, 'admin', 'Wrong quantity entered');
    strict_1.default.equal(reversal.qtyDelta, -40);
    strict_1.default.equal(reversal.reversalOfId, original.id);
    strict_1.default.equal(ledger.getBalance(key).onHand, 0);
    // The original record persists unchanged apart from carrying the reversal link.
    const [storedOriginal] = ledger.listMovements(key);
    strict_1.default.equal(storedOriginal.qtyDelta, 40);
    strict_1.default.equal(storedOriginal.reversedById, reversal.id);
    // A movement cannot be reversed twice.
    strict_1.default.throws(() => ledger.reverseMovement(original.id, 'admin', 'again'));
});
(0, node_test_1.default)('every movement stores source document, actor, timestamp and correlation id', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    const movement = ledger.postMovement({
        itemId: 'item-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        movementType: 'TRANSFER_IN',
        qtyDelta: 12,
        actor: 'picker-1',
        sourceDocument: 'TRANSFER-0042',
        sourceLineId: 'line-1',
        correlationId: 'corr-abc',
    });
    strict_1.default.equal(movement.sourceDocument, 'TRANSFER-0042');
    strict_1.default.equal(movement.sourceLineId, 'line-1');
    strict_1.default.equal(movement.actor, 'picker-1');
    strict_1.default.equal(movement.correlationId, 'corr-abc');
    strict_1.default.ok(movement.timestamp);
});
(0, node_test_1.default)('reserve and release move quantity between available and reserved without touching on-hand', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
    ledger.postMovement({ ...key, movementType: 'OPENING_STOCK', qtyDelta: 25, actor: 'admin' });
    const afterReserve = ledger.reserve(key, 10);
    strict_1.default.equal(afterReserve.onHand, 25);
    strict_1.default.equal(afterReserve.reserved, 10);
    strict_1.default.equal(afterReserve.available, 15);
    strict_1.default.throws(() => ledger.reserve(key, 20));
    const afterRelease = ledger.releaseReservation(key, 4);
    strict_1.default.equal(afterRelease.reserved, 6);
    strict_1.default.equal(afterRelease.available, 19);
});
(0, node_test_1.default)('different lots at the same location are tracked as separate balances', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    ledger.postMovement({
        itemId: 'item-1',
        lotId: 'lot-A',
        locationId: 'loc-1',
        movementType: 'OPENING_STOCK',
        qtyDelta: 20,
        actor: 'admin',
    });
    ledger.postMovement({
        itemId: 'item-1',
        lotId: 'lot-B',
        locationId: 'loc-1',
        movementType: 'OPENING_STOCK',
        qtyDelta: 40,
        actor: 'admin',
    });
    strict_1.default.equal(ledger.getBalance({ itemId: 'item-1', lotId: 'lot-A', locationId: 'loc-1' }).onHand, 20);
    strict_1.default.equal(ledger.getBalance({ itemId: 'item-1', lotId: 'lot-B', locationId: 'loc-1' }).onHand, 40);
});
(0, node_test_1.default)('different bins at the same location are tracked as separate balances and still sum at location level', () => {
    const ledger = new stock_ledger_js_1.StockLedger();
    const base = { itemId: 'item-1', lotId: 'lot-1', locationId: 'wh-1' };
    ledger.postMovement({ ...base, binId: 'A-01', movementType: 'TRANSFER_IN', qtyDelta: 8, actor: 'picker' });
    ledger.postMovement({ ...base, binId: 'B-02', movementType: 'TRANSFER_IN', qtyDelta: 5, actor: 'picker' });
    strict_1.default.equal(ledger.getBalance({ ...base, binId: 'A-01' }).onHand, 8);
    strict_1.default.equal(ledger.getBalance({ ...base, binId: 'B-02' }).onHand, 5);
    strict_1.default.equal(ledger.getLocationOnHand('item-1', 'lot-1', 'wh-1'), 13);
});
