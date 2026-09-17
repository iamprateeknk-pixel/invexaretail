import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExpiryBoard,
  calendarDaysUntilExpiry,
  classifyExpiryHorizon,
  emptyExpiryBoard,
  estimateLotValue,
  matchesExpiryHorizon,
  recommendedExpiryActionForHorizon,
} from './expiry-board.js';

const now = new Date('2026-09-13T10:00:00');

test('calendar expiry uses local start-of-day and missing dates stay null', () => {
  assert.equal(calendarDaysUntilExpiry(null, now), null);
  assert.equal(calendarDaysUntilExpiry('2026-09-13', now), 0);
  assert.equal(calendarDaysUntilExpiry('2026-09-20', now), 7);
  assert.equal(calendarDaysUntilExpiry('2026-09-12', now), -1);
});

test('horizon and recommended FEFO actions cover the full grocery queue', () => {
  assert.equal(classifyExpiryHorizon(null), 'MISSING');
  assert.equal(classifyExpiryHorizon(-1), 'EXPIRED');
  assert.equal(classifyExpiryHorizon(7), 'CRITICAL');
  assert.equal(classifyExpiryHorizon(30), 'WARNING');
  assert.equal(classifyExpiryHorizon(90), 'UPCOMING');
  assert.equal(classifyExpiryHorizon(91), 'DATED');
  assert.match(recommendedExpiryActionForHorizon('EXPIRED'), /write-off/);
  assert.match(recommendedExpiryActionForHorizon('MISSING'), /expiry date/);
  assert.equal(matchesExpiryHorizon('MISSING', 'action'), true);
  assert.equal(matchesExpiryHorizon('DATED', 'action'), false);
  assert.equal(matchesExpiryHorizon('UPCOMING', 'risk'), true);
});

test('lot value prefers purchase closing value then rate', () => {
  assert.equal(estimateLotValue({ purchaseValue: 120 }, 4), 120);
  assert.equal(estimateLotValue({ purchaseRate: 10 }, 4), 40);
  assert.equal(estimateLotValue({ saleValue: 80 }, 2), 80);
  assert.equal(estimateLotValue({}, 2), null);
});

test('expiry board includes missing dates and ranks expired lots first', () => {
  const board = buildExpiryBoard({
    now,
    items: [
      { id: 'i1', code: 'RICE', name: 'Rice', category: 'Staples', unit: 'KG' },
      { id: 'i2', code: 'MILK', name: 'Milk', category: 'Dairy', unit: 'PCS' },
    ],
    lots: [
      { id: 'l-expired', lotNo: 'E1', expiryDate: '2026-09-01', attributes: { purchaseValue: 400 } },
      { id: 'l-soon', lotNo: 'S1', expiryDate: '2026-09-16', attributes: { purchaseValue: 90 } },
      { id: 'l-safe', lotNo: 'F1', expiryDate: '2027-04-01' },
      { id: 'l-missing', lotNo: 'M1', expiryDate: null },
    ],
    stock: [
      { itemId: 'i1', lotId: 'l-expired', locationId: 'loc-1', quantity: 12 },
      { itemId: 'i2', lotId: 'l-soon', locationId: 'loc-1', quantity: 6 },
      { itemId: 'i1', lotId: 'l-safe', locationId: 'loc-1', quantity: 40 },
      { itemId: 'i2', lotId: 'l-missing', locationId: 'loc-1', quantity: 8 },
      { itemId: 'i2', lotId: 'l-soon', locationId: 'loc-1', quantity: 0 },
    ],
  });

  assert.equal(board.lots.length, 4);
  assert.equal(board.lots[0].horizon, 'EXPIRED');
  assert.equal(board.lots[0].quantity, 12);
  assert.equal(board.summary.expiredLots, 1);
  assert.equal(board.summary.expiredQty, 12);
  assert.equal(board.summary.expiredValue, 400);
  assert.equal(board.summary.criticalLots, 1);
  assert.equal(board.summary.missingLots, 1);
  assert.equal(board.summary.missingQty, 8);
  assert.equal(board.summary.datedOnHandLots, 3);
  assert.equal(board.summary.atRiskLots, 2);
  assert.deepEqual(board.categories, ['Dairy', 'Staples']);
  assert.equal(emptyExpiryBoard().lots.length, 0);
});
