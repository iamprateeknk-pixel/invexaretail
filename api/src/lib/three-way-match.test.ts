import test from 'node:test';
import assert from 'node:assert/strict';
import { matchThreeWay } from './three-way-match.js';

test('matching qty and price across PO, receipt and invoice is MATCHED', () => {
  const result = matchThreeWay(
    [{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }],
    [{ itemId: 'a', invoicedQty: 10, unitCost: 100 }],
  );
  assert.equal(result.matched, true);
  assert.equal(result.lines[0].exceptions.length, 0);
});

test('invoicing more than was received flags OVER_INVOICED_QTY', () => {
  const result = matchThreeWay(
    [{ itemId: 'a', orderedQty: 10, receivedQty: 8, unitCost: 100 }],
    [{ itemId: 'a', invoicedQty: 10, unitCost: 100 }],
  );
  assert.equal(result.matched, false);
  assert.deepEqual(result.lines[0].exceptions, ['OVER_INVOICED_QTY']);
});

test('invoicing at or below what was received is fine even if less than ordered', () => {
  const result = matchThreeWay(
    [{ itemId: 'a', orderedQty: 10, receivedQty: 8, unitCost: 100 }],
    [{ itemId: 'a', invoicedQty: 8, unitCost: 100 }],
  );
  assert.equal(result.matched, true);
});

test('a price beyond tolerance flags PRICE_VARIANCE', () => {
  const result = matchThreeWay(
    [{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }],
    [{ itemId: 'a', invoicedQty: 10, unitCost: 110 }],
    2,
  );
  assert.deepEqual(result.lines[0].exceptions, ['PRICE_VARIANCE']);
});

test('a price within tolerance is not flagged', () => {
  const result = matchThreeWay(
    [{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }],
    [{ itemId: 'a', invoicedQty: 10, unitCost: 101 }],
    2,
  );
  assert.equal(result.lines[0].exceptions.length, 0);
});

test('invoicing an item that is not on the PO at all flags UNKNOWN_ITEM', () => {
  const result = matchThreeWay(
    [{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }],
    [{ itemId: 'a', invoicedQty: 10, unitCost: 100 }, { itemId: 'ghost', invoicedQty: 1, unitCost: 5 }],
  );
  const ghost = result.lines.find((line) => line.itemId === 'ghost');
  assert.deepEqual(ghost?.exceptions, ['UNKNOWN_ITEM']);
  assert.equal(result.matched, false);
});

test('a PO line not yet invoiced is not an exception by itself', () => {
  const result = matchThreeWay(
    [{ itemId: 'a', orderedQty: 10, receivedQty: 10, unitCost: 100 }],
    [],
  );
  assert.equal(result.matched, true);
  assert.equal(result.lines[0].invoicedQty, 0);
});

test('multiple exceptions on the same line are all reported, not just the first', () => {
  const result = matchThreeWay(
    [{ itemId: 'a', orderedQty: 10, receivedQty: 5, unitCost: 100 }],
    [{ itemId: 'a', invoicedQty: 10, unitCost: 130 }],
    2,
  );
  assert.deepEqual(result.lines[0].exceptions.sort(), ['OVER_INVOICED_QTY', 'PRICE_VARIANCE'].sort());
});
