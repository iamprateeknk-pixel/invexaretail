"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const transfer_packing_js_1 = require("./transfer-packing.js");
const expected = [{ itemId: 'a', lotId: 'l1', requestedQty: 10 }, { itemId: 'b', lotId: 'l2', requestedQty: 2.5 }];
const carton = (id, lines, status = 'SEALED') => ({
    id, transferId: 't', cartonNumber: id, packageId: `P-${id}`, status, packedById: 'u', sealedAt: '2026-09-19T00:00:00Z',
    lines: lines.map(([itemId, lotId, quantity]) => ({ itemId, lotId, quantity })), quantity: lines.reduce((sum, [, , q]) => sum + q, 0),
});
(0, node_test_1.default)('a carton may not exceed what is left to pack, nor hold an unexpected item', () => {
    const packed = [carton('1', [['a', 'l1', 6]])];
    strict_1.default.deepEqual((0, transfer_packing_js_1.checkCartonLines)(expected, packed, [{ itemId: 'a', lotId: 'l1', quantity: 4 }]), []);
    strict_1.default.deepEqual((0, transfer_packing_js_1.checkCartonLines)(expected, packed, [{ itemId: 'a', lotId: 'l1', quantity: 5 }]), [{ itemId: 'a', lotId: 'l1', kind: 'OVER', quantity: 5, remaining: 4 }]);
    strict_1.default.equal((0, transfer_packing_js_1.checkCartonLines)(expected, packed, [{ itemId: 'z', lotId: 'l9', quantity: 1 }])[0].kind, 'UNEXPECTED');
    // Two lines for the same item in one carton are added together.
    strict_1.default.equal((0, transfer_packing_js_1.checkCartonLines)(expected, packed, [{ itemId: 'a', lotId: 'l1', quantity: 3 }, { itemId: 'a', lotId: 'l1', quantity: 2 }])[0].kind, 'OVER');
});
(0, node_test_1.default)('packing verifies only sealed cartons and handles decimal weights exactly', () => {
    const cartons = [carton('1', [['a', 'l1', 10]]), carton('2', [['b', 'l2', 1.5]]), carton('3', [['b', 'l2', 1]]), carton('4', [['b', 'l2', 9]], 'VOID')];
    const result = (0, transfer_packing_js_1.verifyTransferPacking)(expected, cartons);
    strict_1.default.equal(result.readyToSeal, true);
    strict_1.default.equal((0, transfer_packing_js_1.verifyTransferPacking)(expected, cartons.slice(0, 2)).readyToSeal, false);
});
(0, node_test_1.default)('carton numbers and package ids are sequential and readable', () => {
    strict_1.default.equal((0, transfer_packing_js_1.nextCartonNumber)([]), 1);
    strict_1.default.equal((0, transfer_packing_js_1.nextCartonNumber)([carton('1', []), carton('3', [])]), 4);
    strict_1.default.equal((0, transfer_packing_js_1.packageIdFor)('transfer-abc123', 2), 'PKG-ABC123-02');
});
(0, node_test_1.default)('dispatch needs a carrier, vehicle or AWB, and a sane arrival time', () => {
    const now = new Date('2026-09-19T10:00:00Z');
    strict_1.default.throws(() => (0, transfer_packing_js_1.parseDispatchDetails)({}, now), /vehicle number, courier or AWB/);
    strict_1.default.throws(() => (0, transfer_packing_js_1.parseDispatchDetails)({ awb: 'X', expectedArrivalAt: 'soon' }, now), /valid date/);
    strict_1.default.throws(() => (0, transfer_packing_js_1.parseDispatchDetails)({ awb: 'X', expectedArrivalAt: '2026-09-01T00:00:00Z' }, now), /past/);
    strict_1.default.deepEqual((0, transfer_packing_js_1.parseDispatchDetails)({ vehicleNo: ' MH12 ', expectedArrivalAt: '2026-09-20T10:00:00Z' }, now), { vehicleNo: 'MH12', expectedArrivalAt: '2026-09-20T10:00:00.000Z' });
});
(0, node_test_1.default)('a transfer is delayed only while it is in transit past its promised arrival', () => {
    const now = new Date('2026-09-19T10:00:00Z');
    const late = '2026-09-19T08:00:00Z';
    strict_1.default.equal((0, transfer_packing_js_1.isTransitDelayed)({ status: 'IN_TRANSIT', expectedArrivalAt: late, now }), true);
    strict_1.default.equal((0, transfer_packing_js_1.isTransitDelayed)({ status: 'DISPATCHED', expectedArrivalAt: '2026-09-19T12:00:00Z', now }), false);
    strict_1.default.equal((0, transfer_packing_js_1.isTransitDelayed)({ status: 'RECEIVED', expectedArrivalAt: late, now }), false);
    strict_1.default.equal((0, transfer_packing_js_1.isTransitDelayed)({ status: 'IN_TRANSIT', now }), false);
});
