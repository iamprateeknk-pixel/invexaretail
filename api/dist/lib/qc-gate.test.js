"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const qc_gate_js_1 = require("./qc-gate.js");
(0, node_test_1.default)('the latest applicable inspection decides, and none means no verdict', () => {
    const inspections = [
        { itemId: 'a', sourceLineId: 'l1', overallResult: 'FAIL', createdAt: '2026-09-19T08:00:00Z' },
        { itemId: 'a', sourceLineId: 'l1', overallResult: 'PASS', createdAt: '2026-09-19T09:00:00Z' },
        { itemId: 'b', sourceLineId: null, results: { seal: 'FAIL', label: 'PASS' } },
    ];
    strict_1.default.equal((0, qc_gate_js_1.verdictForLine)(inspections, { itemId: 'a', lineId: 'l1' }), 'PASS', 're-inspection replaces the earlier failure');
    strict_1.default.equal((0, qc_gate_js_1.verdictForLine)(inspections, { itemId: 'b', lineId: 'anything' }), 'FAIL', 'a whole-item inspection applies to any line; results are evaluated when there is no overall');
    strict_1.default.equal((0, qc_gate_js_1.verdictForLine)(inspections, { itemId: 'a', lineId: 'other-line' }), null, 'an inspection of another line does not count');
    strict_1.default.equal((0, qc_gate_js_1.verdictForLine)(inspections, { itemId: 'zzz' }), null);
});
(0, node_test_1.default)('a failed inspection moves the received quantity to quarantine without changing the totals', () => {
    const lines = [
        { itemId: 'a', lotId: 'l1', lineId: 'x', receivedQty: 6, damagedQty: 1 },
        { itemId: 'b', lotId: 'l2', lineId: 'y', receivedQty: 4, damagedQty: 0 },
        { itemId: 'c', lotId: 'l3', lineId: 'z', receivedQty: 0, damagedQty: 2 },
    ];
    const verdicts = { a: 'FAIL', b: 'PASS', c: 'FAIL' };
    const result = (0, qc_gate_js_1.quarantineFailedLines)(lines, (line) => verdicts[line.itemId]);
    strict_1.default.deepEqual(result.lines.map((line) => [line.itemId, line.receivedQty, line.damagedQty]), [['a', 0, 7], ['b', 4, 0], ['c', 0, 2]]);
    strict_1.default.deepEqual(result.quarantined, [{ itemId: 'a', lotId: 'l1', quantity: 6 }]);
    strict_1.default.equal(lines[0].receivedQty, 6, 'the input is not mutated');
});
