// Regression: parseBody writes the parsed `lines` array back over req.body.lines, so a field the
// line schema does not declare is stripped before the handler reads it. The PO receipt schema
// omitted lineId/lotNo/expiryDate - every POST /purchase-orders/:id/receive failed with
// "Purchase order line  was not found." - and the transfer receipt schema omitted lineId, which
// pins a QC inspection to its line. These tests run the real parseBody, as the routes do.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { parseBody } from './validate.js';
import { poReceiveSchema, transferReceiveSchema } from './validation-schemas.js';

function run(schema: Parameters<typeof parseBody>[2], body: Record<string, unknown>) {
  const req = { body } as Request;
  let status = 200;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  const parsed = parseBody(req, res, schema);
  return { req, status, parsed };
}

test('PO receive: lineId, lotNo and expiryDate reach the handler after validation', () => {
  const { req, status, parsed } = run(poReceiveSchema, {
    requestId: 'req-1',
    lines: [{ lineId: 'pol-1', receivedQty: '8', damagedQty: 2, excessQty: 0, lotNo: 'LOT-9', expiryDate: '2027-01-31' }],
  });
  assert.notEqual(parsed, null);
  assert.equal(status, 200);
  const [line] = req.body.lines;
  assert.equal(line.lineId, 'pol-1');
  assert.equal(line.lotNo, 'LOT-9');
  assert.equal(line.expiryDate, '2027-01-31');
  assert.equal(line.receivedQty, 8, 'numeric strings are still coerced');
});

test('PO receive: a null lot/expiry is accepted (the handler treats it as absent), and unknown keys survive', () => {
  const { req, parsed } = run(poReceiveSchema, {
    requestId: 'req-2',
    lines: [{ lineId: 'pol-1', receivedQty: 1, lotNo: null, expiryDate: null, binCode: 'A-01' }],
  });
  assert.notEqual(parsed, null);
  assert.equal(req.body.lines[0].lotNo, null);
  assert.equal(req.body.lines[0].binCode, 'A-01');
});

test('transfer receive: lineId survives validation so QC verdicts match their own line', () => {
  const { req, parsed } = run(transferReceiveSchema, {
    requestId: 'req-3',
    lines: [{ lineId: 'tl-1', itemId: 'item-1', lotId: 'lot-1', receivedQty: 5 }],
  });
  assert.notEqual(parsed, null);
  assert.equal(req.body.lines[0].lineId, 'tl-1');
});
