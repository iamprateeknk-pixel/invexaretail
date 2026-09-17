import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReceiptQcComplete, receiptLineRequiresQc } from './qc-receive.js';

const templates = [
  { id: 'global', category: null, active: true },
  { id: 'dairy', category: 'Dairy', active: true },
];

test('receiptLineRequiresQc is false for zero-qty lines even when a template exists', () => {
  assert.equal(receiptLineRequiresQc({ itemId: 'i1', receivedQty: 0, hasInspection: false, itemCategory: 'Dairy' }, templates), false);
});

test('receiptLineRequiresQc is true when a matching template exists and qty was received', () => {
  assert.equal(receiptLineRequiresQc({ itemId: 'i1', receivedQty: 4, hasInspection: false, itemCategory: 'Dairy' }, templates), true);
});

test('assertReceiptQcComplete blocks a received line with no inspection', () => {
  const blocked = assertReceiptQcComplete(
    [{ itemId: 'i1', lineId: 'line-1', receivedQty: 2, hasInspection: false, itemCategory: 'Dairy' }],
    templates,
  );
  assert.equal(blocked.ok, false);
});

test('assertReceiptQcComplete passes when every received line already has an inspection', () => {
  const ok = assertReceiptQcComplete(
    [
      { itemId: 'i1', receivedQty: 2, hasInspection: true, itemCategory: 'Dairy' },
      { itemId: 'i2', receivedQty: 0, hasInspection: false, itemCategory: 'Dairy' },
    ],
    templates,
  );
  assert.equal(ok.ok, true);
});

test('assertReceiptQcComplete is a no-op when no QC templates are published', () => {
  const ok = assertReceiptQcComplete(
    [{ itemId: 'i1', receivedQty: 5, hasInspection: false, itemCategory: 'Dairy' }],
    [],
  );
  assert.equal(ok.ok, true);
});
