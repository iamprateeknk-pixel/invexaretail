import assert from 'node:assert/strict';
import test from 'node:test';
import { cartonPayload, dispatchPayload, logisticsLabel, remainingLines } from './transfer-packing.js';

const state = {
  expected: [{ itemId: 'a', lotId: 'l1', requestedQty: 10 }, { itemId: 'b', lotId: 'l2', requestedQty: 2.5 }],
  cartons: [
    { status: 'SEALED', lines: [{ itemId: 'a', lotId: 'l1', quantity: 6 }] },
    { status: 'VOID', lines: [{ itemId: 'a', lotId: 'l1', quantity: 4 }] },
  ],
};

test('remaining ignores voided cartons', () => {
  assert.deepEqual(remainingLines(state).map((row) => [row.itemId, row.packed, row.remaining]), [['a', 6, 4], ['b', 0, 2.5]]);
});

test('a carton body keeps only filled lines and refuses over-packing', () => {
  const lines = remainingLines(state);
  const body = cartonPayload(lines, { 'a|l1': '4', 'b|l2': '0' }, '3.5', 'req-1');
  assert.deepEqual(body, { requestId: 'req-1', lines: [{ itemId: 'a', lotId: 'l1', quantity: 4 }], weightKg: 3.5 });
  assert.throws(() => cartonPayload(lines, { 'a|l1': '5' }, '', 'r'), /more than is left/);
  assert.throws(() => cartonPayload(lines, {}, '', 'r'), /at least one item/);
  assert.throws(() => cartonPayload(lines, { 'a|l1': '1' }, '-2', 'r'), /weight/);
  assert.throws(() => cartonPayload(lines, { 'a|l1': 'x' }, '', 'r'), /valid quantity/);
});

test('dispatch needs a vehicle, courier or AWB; blank fields are dropped', () => {
  assert.throws(() => dispatchPayload({ carrier: '  ' }), /vehicle number, courier or AWB/);
  assert.deepEqual(dispatchPayload({ carrier: ' BlueDart ', awb: '', vehicleNo: 'MH12' }), { carrier: 'BlueDart', vehicleNo: 'MH12' });
  assert.equal(dispatchPayload({ awb: 'X', expectedArrivalAt: '2026-09-20T10:00' }).expectedArrivalAt.length > 10, true);
  assert.throws(() => dispatchPayload({ awb: 'X', expectedArrivalAt: 'soon' }), /valid date/);
});

test('the queue label follows the stage', () => {
  assert.equal(logisticsLabel({}), '');
  assert.equal(logisticsLabel({ cartons: [{}] }), 'Packing');
  assert.equal(logisticsLabel({ packing: {} }), 'Packed');
  assert.equal(logisticsLabel({ packing: {}, dispatch: {} }), 'Dispatched');
  assert.equal(logisticsLabel({ dispatch: {}, delayed: true }), 'Delayed');
});
