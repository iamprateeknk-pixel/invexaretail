"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const three_way_match_js_1 = require("./three-way-match.js");
(0, node_test_1.default)('matching qty and price across PO, receipt and invoice is MATCHED', () => {
    const result = (0, three_way_match_js_1.matchThreeWay)([{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }], [{ itemId: 'a', invoicedQty: 10, unitCost: 100 }]);
    strict_1.default.equal(result.matched, true);
    strict_1.default.equal(result.lines[0].exceptions.length, 0);
});
(0, node_test_1.default)('invoicing more than was received flags OVER_INVOICED_QTY', () => {
    const result = (0, three_way_match_js_1.matchThreeWay)([{ itemId: 'a', orderedQty: 10, receivedQty: 8, unitCost: 100 }], [{ itemId: 'a', invoicedQty: 10, unitCost: 100 }]);
    strict_1.default.equal(result.matched, false);
    strict_1.default.deepEqual(result.lines[0].exceptions, ['OVER_INVOICED_QTY']);
});
(0, node_test_1.default)('invoicing at or below what was received is fine even if less than ordered', () => {
    const result = (0, three_way_match_js_1.matchThreeWay)([{ itemId: 'a', orderedQty: 10, receivedQty: 8, unitCost: 100 }], [{ itemId: 'a', invoicedQty: 8, unitCost: 100 }]);
    strict_1.default.equal(result.matched, true);
});
(0, node_test_1.default)('a price beyond tolerance flags PRICE_VARIANCE', () => {
    const result = (0, three_way_match_js_1.matchThreeWay)([{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }], [{ itemId: 'a', invoicedQty: 10, unitCost: 110 }], 2);
    strict_1.default.deepEqual(result.lines[0].exceptions, ['PRICE_VARIANCE']);
});
(0, node_test_1.default)('a price within tolerance is not flagged', () => {
    const result = (0, three_way_match_js_1.matchThreeWay)([{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }], [{ itemId: 'a', invoicedQty: 10, unitCost: 101 }], 2);
    strict_1.default.equal(result.lines[0].exceptions.length, 0);
});
(0, node_test_1.default)('invoicing an item that is not on the PO at all flags UNKNOWN_ITEM', () => {
    const result = (0, three_way_match_js_1.matchThreeWay)([{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }], [{ itemId: 'a', invoicedQty: 10, unitCost: 100 }, { itemId: 'ghost', invoicedQty: 1, unitCost: 5 }]);
    const ghost = result.lines.find((line) => line.itemId === 'ghost');
    strict_1.default.deepEqual(ghost?.exceptions, ['UNKNOWN_ITEM']);
    strict_1.default.equal(result.matched, false);
});
(0, node_test_1.default)('a PO line not yet invoiced is not an exception by itself', () => {
    const result = (0, three_way_match_js_1.matchThreeWay)([{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }], []);
    strict_1.default.equal(result.matched, true);
    strict_1.default.equal(result.lines[0].invoicedQty, 0);
});
(0, node_test_1.default)('multiple exceptions on the same line are all reported, not just the first', () => {
    const result = (0, three_way_match_js_1.matchThreeWay)([{ itemId: 'a', orderedQty: 10, receivedQty: 5, unitCost: 100 }], [{ itemId: 'a', invoicedQty: 10, unitCost: 130 }], 2);
    strict_1.default.deepEqual(result.lines[0].exceptions.sort(), ['OVER_INVOICED_QTY', 'PRICE_VARIANCE'].sort());
});
