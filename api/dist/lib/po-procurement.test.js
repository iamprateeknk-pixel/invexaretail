"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const po_lifecycle_js_1 = require("./po-lifecycle.js");
const po_receipt_js_1 = require("./po-receipt.js");
const po_planning_js_1 = require("./po-planning.js");
const message = (result) => ('message' in result ? String(result.message) : '');
// ---- lifecycle ------------------------------------------------------------
(0, node_test_1.default)('a purchase order follows draft -> approval -> send, and cannot skip approval', () => {
    strict_1.default.deepEqual((0, po_lifecycle_js_1.allowedPoMoves)('DRAFT'), ['SUBMITTED', 'CANCELLED']);
    strict_1.default.equal((0, po_lifecycle_js_1.checkPoMove)({ from: 'DRAFT', to: 'APPROVED', anyReceived: false, invoiceStatuses: [] }).ok, false);
    strict_1.default.equal((0, po_lifecycle_js_1.checkPoMove)({ from: 'SUBMITTED', to: 'APPROVED', anyReceived: false, invoiceStatuses: [] }).ok, true);
    strict_1.default.equal((0, po_lifecycle_js_1.checkPoMove)({ from: 'APPROVED', to: 'SENT', anyReceived: false, invoiceStatuses: [] }).ok, true);
    strict_1.default.equal((0, po_lifecycle_js_1.checkPoMove)({ from: 'RECEIVED', to: 'DRAFT', anyReceived: true, invoiceStatuses: [] }).ok, false);
    strict_1.default.deepEqual((0, po_lifecycle_js_1.allowedPoMoves)('CANCELLED'), []);
});
(0, node_test_1.default)('goods can only be received against an approved, open order', () => {
    for (const status of ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'])
        strict_1.default.equal((0, po_lifecycle_js_1.isReceivablePo)(status), true);
    for (const status of ['DRAFT', 'SUBMITTED', 'RECEIVED', 'CLOSED', 'CANCELLED'])
        strict_1.default.equal((0, po_lifecycle_js_1.isReceivablePo)(status), false);
});
(0, node_test_1.default)('an order with goods against it cannot be cancelled; closing follows the invoice match', () => {
    const cancelled = (0, po_lifecycle_js_1.checkPoMove)({ from: 'APPROVED', to: 'CANCELLED', anyReceived: true, invoiceStatuses: [] });
    strict_1.default.equal(cancelled.ok, false);
    const noInvoice = (0, po_lifecycle_js_1.checkPoMove)({ from: 'RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: [] });
    strict_1.default.match(message(noInvoice), /No supplier invoice/);
    strict_1.default.equal((0, po_lifecycle_js_1.checkPoMove)({ from: 'RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: ['EXCEPTION'], note: 'Supplier credit note pending' }).ok, true);
    strict_1.default.equal((0, po_lifecycle_js_1.checkPoMove)({ from: 'RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: ['EXCEPTION', 'MATCHED'] }).ok, true);
    const short = (0, po_lifecycle_js_1.checkPoMove)({ from: 'PARTIALLY_RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: ['MATCHED'] });
    strict_1.default.match(message(short), /short close/);
    strict_1.default.equal((0, po_lifecycle_js_1.checkPoMove)({ from: 'PARTIALLY_RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: ['MATCHED'], note: 'Supplier will not ship the rest' }).ok, true);
});
// ---- receipt --------------------------------------------------------------
const lines = [
    { id: 'l1', itemId: 'milk', quantity: 10, receivedQty: 0, unitCost: 5 },
    { id: 'l2', itemId: 'rice', quantity: 4, receivedQty: 1, unitCost: 40 },
];
const items = new Map([
    ['milk', { code: 'MILK', lotRequired: true, expiryRequired: true }],
    ['rice', { code: 'RICE' }],
]);
const today = new Date('2026-09-19T00:00:00Z');
(0, node_test_1.default)('a receipt needs lot and expiry where the item demands them, and refuses an expired sellable lot', () => {
    const base = { orderNumber: 'PO-9', lines, items, today };
    const noLot = (0, po_receipt_js_1.planPoReceipt)({ ...base, receipt: [{ lineId: 'l1', receivedQty: 5 }] });
    strict_1.default.match(message(noLot), /lot number/);
    const noExpiry = (0, po_receipt_js_1.planPoReceipt)({ ...base, receipt: [{ lineId: 'l1', receivedQty: 5, lotNo: 'B1' }] });
    strict_1.default.match(message(noExpiry), /expiry date/);
    const expired = (0, po_receipt_js_1.planPoReceipt)({ ...base, receipt: [{ lineId: 'l1', receivedQty: 5, lotNo: 'B1', expiryDate: '2026-09-01' }] });
    strict_1.default.match(message(expired), /already expired/);
    const good = (0, po_receipt_js_1.planPoReceipt)({ ...base, receipt: [{ lineId: 'l1', receivedQty: 5, lotNo: 'B1', expiryDate: '2027-01-31' }] });
    strict_1.default.equal(good.ok && good.postings[0].lotNo, 'B1');
    strict_1.default.equal(good.ok && good.postings[0].expiryDate, '2027-01-31');
});
(0, node_test_1.default)('damaged goods count against the order but are never sellable; excess is separate', () => {
    const plan = (0, po_receipt_js_1.planPoReceipt)({ orderNumber: 'PO-9', lines, items, today, receipt: [
            { lineId: 'l1', receivedQty: 6, damagedQty: 2, lotNo: 'B1', expiryDate: '2027-01-31' },
            { lineId: 'l2', receivedQty: 3, excessQty: 1 },
        ] });
    strict_1.default.equal(plan.ok, true);
    if (!plan.ok)
        return;
    strict_1.default.deepEqual(plan.postings.map((row) => [row.lineId, row.goodQty, row.damagedQty, row.excessQty, row.arrivedQty]), [['l1', 6, 2, 0, 8], ['l2', 3, 0, 1, 3]]);
    strict_1.default.equal(plan.postings[1].lotNo, 'PO-PO-9', 'a plain item lands in the order lot');
    strict_1.default.equal((0, po_receipt_js_1.statusAfterReceipt)(lines, plan.postings), 'PARTIALLY_RECEIVED');
});
(0, node_test_1.default)('receiving more than is open is refused unless it is declared as excess', () => {
    const over = (0, po_receipt_js_1.planPoReceipt)({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'l2', receivedQty: 4 }] });
    strict_1.default.match(message(over), /Only 3 is still open/);
    const dupe = (0, po_receipt_js_1.planPoReceipt)({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'l2', receivedQty: 1 }, { lineId: 'l2', receivedQty: 1 }] });
    strict_1.default.equal(dupe.ok, false);
    strict_1.default.equal((0, po_receipt_js_1.planPoReceipt)({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'nope', receivedQty: 1 }] }).ok, false);
    strict_1.default.equal((0, po_receipt_js_1.planPoReceipt)({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'l1', receivedQty: 0 }] }).ok, false);
    strict_1.default.equal((0, po_receipt_js_1.planPoReceipt)({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'l1', receivedQty: -1 }] }).ok, false);
});
(0, node_test_1.default)('the order completes only when every line has fully arrived', () => {
    const finishing = (0, po_receipt_js_1.planPoReceipt)({ orderNumber: 'PO-9', lines, items, today, receipt: [
            { lineId: 'l1', receivedQty: 10, lotNo: 'B1', expiryDate: '2027-01-31' }, { lineId: 'l2', receivedQty: 2, damagedQty: 1 },
        ] });
    strict_1.default.equal(finishing.ok && (0, po_receipt_js_1.statusAfterReceipt)(lines, finishing.postings), 'RECEIVED');
});
// ---- planning -------------------------------------------------------------
const supplier = { id: 's1', name: 'Fresh Foods', leadTimeDays: 4, moq: 24, status: 'ACTIVE' };
(0, node_test_1.default)('planning counts open orders and stock in transit before recommending, and explains itself', () => {
    const result = (0, po_planning_js_1.planPurchases)({
        suppliers: [supplier],
        items: [
            { itemId: 'a', code: 'A', onHand: 4, minQty: 10, targetQty: 40, openPoQty: 0, inTransitQty: 0, supplierId: 's1' },
            { itemId: 'b', code: 'B', onHand: 4, minQty: 10, targetQty: 40, openPoQty: 30, inTransitQty: 0, supplierId: 's1' },
            { itemId: 'c', code: 'C', onHand: 4, minQty: 10, targetQty: 40, openPoQty: 0, inTransitQty: 20, supplierId: 's1' },
        ],
    });
    strict_1.default.deepEqual(result.suggestions.map((row) => [row.itemId, row.quantity]), [['a', 36]]);
    strict_1.default.equal(result.skipped.length, 2);
    strict_1.default.match(result.skipped[0].reason, /covered/);
    const [a] = result.suggestions;
    strict_1.default.equal(a.urgency, 'HIGH');
    strict_1.default.equal(a.confidence, 'LOW', 'no sales history');
    strict_1.default.ok(a.explanation.length >= 4);
    strict_1.default.match(a.explanation[0], /Position 4 = 4 available/);
});
(0, node_test_1.default)('demand over the lead time raises the reorder point, and confidence follows the data window', () => {
    const [row] = (0, po_planning_js_1.planPurchases)({
        suppliers: [supplier],
        items: [{ itemId: 'a', code: 'A', onHand: 30, minQty: 5, targetQty: 20, openPoQty: 0, inTransitQty: 0, avgDailyDemand: 6, demandDays: 30, supplierId: 's1' }],
    }).suggestions;
    // lead 4 days * 6/day = 24, + 5 minimum = reorder point 29; position 30 is above it? 30 > 29, so covered.
    strict_1.default.equal(row, undefined);
    const [needed] = (0, po_planning_js_1.planPurchases)({
        suppliers: [supplier],
        items: [{ itemId: 'a', code: 'A', onHand: 20, minQty: 5, targetQty: 20, openPoQty: 0, inTransitQty: 0, avgDailyDemand: 6, demandDays: 30, supplierId: 's1' }],
    }).suggestions;
    strict_1.default.equal(needed.reorderPoint, 29);
    strict_1.default.equal(needed.orderUpTo, 71, 'reorder point 29 + 7 days of cover (42)');
    strict_1.default.equal(needed.quantity, 51);
    strict_1.default.equal(needed.confidence, 'HIGH');
    strict_1.default.equal(needed.daysOfCover, 3.333);
});
(0, node_test_1.default)('the supplier minimum order lifts a small need, reserved stock is not available, and a blocked supplier is flagged', () => {
    const [small] = (0, po_planning_js_1.planPurchases)({ suppliers: [supplier], items: [{ itemId: 'a', onHand: 8, minQty: 10, targetQty: 12, openPoQty: 0, inTransitQty: 0, supplierId: 's1' }] }).suggestions;
    strict_1.default.equal(small.quantity, 24);
    strict_1.default.match(small.explanation.join(' '), /supplier minimum order of 24/);
    const [reserved] = (0, po_planning_js_1.planPurchases)({ suppliers: [], items: [{ itemId: 'a', onHand: 12, reserved: 8, minQty: 5, targetQty: 20, openPoQty: 0, inTransitQty: 0 }] }).suggestions;
    strict_1.default.equal(reserved.position, 4);
    strict_1.default.equal(reserved.supplierId, null);
    const blocked = (0, po_planning_js_1.planPurchases)({ suppliers: [{ ...supplier, status: 'BLOCKED' }], items: [{ itemId: 'a', code: 'A', onHand: 1, minQty: 5, targetQty: 20, openPoQty: 0, inTransitQty: 0, supplierId: 's1' }] });
    strict_1.default.equal(blocked.suggestions[0].supplierId, null);
    strict_1.default.match(blocked.skipped[0].reason, /blocked/);
});
(0, node_test_1.default)('an item with neither a rule nor sales is not guessed at; suggestions are grouped per supplier, worst first', () => {
    const none = (0, po_planning_js_1.planPurchases)({ suppliers: [], items: [{ itemId: 'a', code: 'A', onHand: 0, minQty: 0, targetQty: 0, openPoQty: 0, inTransitQty: 0 }] });
    strict_1.default.equal(none.suggestions.length, 0);
    strict_1.default.match(none.skipped[0].reason, /no reorder rule/);
    const plan = (0, po_planning_js_1.planPurchases)({
        suppliers: [supplier, { id: 's2', name: 'Grains Co' }],
        items: [
            { itemId: 'a', code: 'A', onHand: 5, minQty: 10, targetQty: 40, openPoQty: 0, inTransitQty: 0, supplierId: 's1', unitCost: 2 },
            { itemId: 'b', code: 'B', onHand: 0, minQty: 10, targetQty: 30, openPoQty: 0, inTransitQty: 0, supplierId: 's2', unitCost: 3 },
            { itemId: 'c', code: 'C', onHand: 2, minQty: 10, targetQty: 30, openPoQty: 0, inTransitQty: 0, supplierId: 's1', unitCost: 1 },
        ],
    });
    strict_1.default.equal(plan.suggestions[0].itemId, 'b', 'zero stock is critical and comes first');
    const groups = (0, po_planning_js_1.groupBySupplier)(plan.suggestions);
    strict_1.default.deepEqual(groups.map((group) => [group.supplierId, group.lines.length]), [['s2', 1], ['s1', 2]]);
    strict_1.default.equal(groups[0].estimatedTotal, 90);
});
