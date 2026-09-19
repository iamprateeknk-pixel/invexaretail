import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCartonLines, isTransitDelayed, nextCartonNumber, packageIdFor, parseDispatchDetails, verifyTransferPacking, type TransferCartonRecord } from './transfer-packing.js';

const expected = [{ itemId: 'a', lotId: 'l1', requestedQty: 10 }, { itemId: 'b', lotId: 'l2', requestedQty: 2.5 }];
const carton = (id: string, lines: Array<[string, string, number]>, status: 'SEALED' | 'VOID' = 'SEALED'): TransferCartonRecord => ({
  id, transferId: 't', cartonNumber: id, packageId: `P-${id}`, status, packedById: 'u', sealedAt: '2026-09-19T00:00:00Z',
  lines: lines.map(([itemId, lotId, quantity]) => ({ itemId, lotId, quantity })), quantity: lines.reduce((sum, [, , q]) => sum + q, 0),
});

test('a carton may not exceed what is left to pack, nor hold an unexpected item', () => {
  const packed = [carton('1', [['a', 'l1', 6]])];
  assert.deepEqual(checkCartonLines(expected, packed, [{ itemId: 'a', lotId: 'l1', quantity: 4 }]), []);
  assert.deepEqual(checkCartonLines(expected, packed, [{ itemId: 'a', lotId: 'l1', quantity: 5 }]), [{ itemId: 'a', lotId: 'l1', kind: 'OVER', quantity: 5, remaining: 4 }]);
  assert.equal(checkCartonLines(expected, packed, [{ itemId: 'z', lotId: 'l9', quantity: 1 }])[0].kind, 'UNEXPECTED');
  // Two lines for the same item in one carton are added together.
  assert.equal(checkCartonLines(expected, packed, [{ itemId: 'a', lotId: 'l1', quantity: 3 }, { itemId: 'a', lotId: 'l1', quantity: 2 }])[0].kind, 'OVER');
});

test('packing verifies only sealed cartons and handles decimal weights exactly', () => {
  const cartons = [carton('1', [['a', 'l1', 10]]), carton('2', [['b', 'l2', 1.5]]), carton('3', [['b', 'l2', 1]]), carton('4', [['b', 'l2', 9]], 'VOID')];
  const result = verifyTransferPacking(expected, cartons);
  assert.equal(result.readyToSeal, true);
  assert.equal(verifyTransferPacking(expected, cartons.slice(0, 2)).readyToSeal, false);
});

test('carton numbers and package ids are sequential and readable', () => {
  assert.equal(nextCartonNumber([]), 1);
  assert.equal(nextCartonNumber([carton('1', []), carton('3', [])]), 4);
  assert.equal(packageIdFor('transfer-abc123', 2), 'PKG-ABC123-02');
});

test('dispatch needs a carrier, vehicle or AWB, and a sane arrival time', () => {
  const now = new Date('2026-09-19T10:00:00Z');
  assert.throws(() => parseDispatchDetails({}, now), /vehicle number, courier or AWB/);
  assert.throws(() => parseDispatchDetails({ awb: 'X', expectedArrivalAt: 'soon' }, now), /valid date/);
  assert.throws(() => parseDispatchDetails({ awb: 'X', expectedArrivalAt: '2026-09-01T00:00:00Z' }, now), /past/);
  assert.deepEqual(parseDispatchDetails({ vehicleNo: ' MH12 ', expectedArrivalAt: '2026-09-20T10:00:00Z' }, now), { vehicleNo: 'MH12', expectedArrivalAt: '2026-09-20T10:00:00.000Z' });
});

test('a transfer is delayed only while it is in transit past its promised arrival', () => {
  const now = new Date('2026-09-19T10:00:00Z');
  const late = '2026-09-19T08:00:00Z';
  assert.equal(isTransitDelayed({ status: 'IN_TRANSIT', expectedArrivalAt: late, now }), true);
  assert.equal(isTransitDelayed({ status: 'DISPATCHED', expectedArrivalAt: '2026-09-19T12:00:00Z', now }), false);
  assert.equal(isTransitDelayed({ status: 'RECEIVED', expectedArrivalAt: late, now }), false);
  assert.equal(isTransitDelayed({ status: 'IN_TRANSIT', now }), false);
});
