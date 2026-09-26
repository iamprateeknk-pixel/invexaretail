import test from 'node:test';
import assert from 'node:assert/strict';
import { sellableQuantity, totalSellable } from './sellable-stock.js';

const now = new Date('2026-09-26T06:30:00Z');

test('only AVAILABLE, unexpired lots count, net of reservations', () => {
  assert.equal(sellableQuantity({ onHand: 10, reserved: 3, lot: { status: 'AVAILABLE', expiryDate: '2026-12-01T00:00:00Z' } }, now), 7);
  assert.equal(sellableQuantity({ onHand: 10, lot: { status: 'BLOCKED' } }, now), 0);
  assert.equal(sellableQuantity({ onHand: 10, lot: { status: 'QUARANTINE' } }, now), 0);
  assert.equal(sellableQuantity({ onHand: 10, lot: { status: 'AVAILABLE', expiryDate: '2026-09-20T00:00:00Z' } }, now), 0, 'lapsed lot is not cover');
  assert.equal(sellableQuantity({ onHand: 10, lot: { status: 'AVAILABLE', expiryDate: '2026-09-26T00:00:00Z' } }, now), 10, 'usable through its expiry date');
});

test('undated lots with no status data are treated as sellable; over-reservation never goes negative', () => {
  assert.equal(sellableQuantity({ onHand: 4 }, now), 4);
  assert.equal(sellableQuantity({ onHand: 4, reserved: 9 }, now), 0);
});

test('an item whose stock is all expired or blocked has zero cover even though on-hand is positive', () => {
  const rows = [
    { onHand: 40, lot: { status: 'AVAILABLE', expiryDate: '2026-09-01T00:00:00Z' } },
    { onHand: 25, lot: { status: 'BLOCKED' } },
    { onHand: 5, reserved: 1, lot: { status: 'AVAILABLE', expiryDate: '2027-01-01T00:00:00Z' } },
  ];
  assert.equal(totalSellable(rows, now), 4);
});
