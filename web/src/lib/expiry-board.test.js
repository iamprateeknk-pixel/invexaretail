import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExpiryBoardFromStock, filterExpiryLots } from './expiry-board.js';

test('client expiry board flags expired, 7-day and missing-date lots', () => {
  const board = buildExpiryBoardFromStock({
    locationId: 'loc-1',
    now: new Date('2026-09-14T12:00:00'),
    items: [
      { id: 'i1', code: 'Y', name: 'Yoghurt', category: 'Dairy', unit: 'cup', lots: [{ id: 'l1', lotNo: 'EXP', expiryDate: '2026-09-01' }] },
      { id: 'i2', code: 'B', name: 'Bread', category: 'Bakery', unit: 'loaf', lots: [{ id: 'l2', lotNo: 'SOON', expiryDate: '2026-09-18' }] },
      { id: 'i3', code: 'F', name: 'Flour', category: 'Staples', unit: 'bag', lots: [{ id: 'l3', lotNo: 'ND', expiryDate: null }] },
    ],
    stockRows: [
      { itemId: 'i1', lotId: 'l1', locationId: 'loc-1', onHand: 6 },
      { itemId: 'i2', lotId: 'l2', locationId: 'loc-1', onHand: 10 },
      { itemId: 'i3', lotId: 'l3', locationId: 'loc-1', onHand: 12 },
    ],
  });
  assert.equal(board.summary.expiredLots, 1);
  assert.equal(board.summary.criticalLots, 1);
  assert.equal(board.summary.missingLots, 1);
  const action = filterExpiryLots(board.lots, { filter: 'action' });
  assert.equal(action.length, 3);
});
