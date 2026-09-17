import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ExpiryWriteOffError,
  buildLocationExpiryBoard,
  listLocationExpiryAlerts,
  setLotExpiryDate,
  setLotSaleStatus,
  writeOffExpiryLot,
} from './expiry-lifecycle.js';
import { adjustStockLedger, findStockLedgerEntry, updateLotExpiry, updateLotStatus } from './repository.js';

const now = new Date('2026-09-14T12:00:00');

test('expiry board surfaces expired, critical and missing-date lots', () => {
  const board = buildLocationExpiryBoard('loc-1', now);
  const horizons = new Map(board.lots.map((lot) => [lot.lotNo, lot.horizon]));
  assert.equal(horizons.get('LOT-EXP'), 'EXPIRED');
  assert.equal(horizons.get('LOT-SOON'), 'CRITICAL');
  assert.equal(horizons.get('LOT-ND'), 'MISSING');
  assert.ok(board.summary.expiredLots >= 1);
  assert.ok(board.summary.missingLots >= 1);
  assert.ok(board.summary.criticalLots >= 1);
});

test('expiry alerts rank soonest dated lots first and skip missing dates', () => {
  const alerts = listLocationExpiryAlerts('loc-1', now);
  assert.ok(alerts.some((alert) => alert.lot.lotNo === 'LOT-EXP'));
  assert.ok(!alerts.some((alert) => alert.lot.lotNo === 'LOT-ND'));
  assert.ok(alerts[0].daysUntilExpiry <= alerts[alerts.length - 1].daysUntilExpiry);
});

test('write-off deducts stock and records an EXPIRY_WRITE_OFF movement', () => {
  const before = findStockLedgerEntry('item-1004', 'lot-1004', 'loc-1')!.onHand;
  const result = writeOffExpiryLot({
    itemId: 'item-1004',
    lotId: 'lot-1004',
    locationId: 'loc-1',
    quantity: 2,
    reason: 'Expired yoghurt verified and discarded',
    actorId: 'user-admin-1',
    role: 'ADMIN',
  });
  assert.equal(result.quantity, 2);
  assert.equal(result.afterBalance, before - 2);
  assert.equal(findStockLedgerEntry('item-1004', 'lot-1004', 'loc-1')!.onHand, before - 2);
  adjustStockLedger('item-1004', 'lot-1004', 'loc-1', 2);
  updateLotStatus('lot-1004', 'AVAILABLE');
});

test('write-off rejects store users, short reasons and over-quantity', () => {
  assert.throws(
    () => writeOffExpiryLot({
      itemId: 'item-1004', lotId: 'lot-1004', locationId: 'loc-1', quantity: 1, reason: 'Expired yoghurt verified', actorId: 'user-store-1', role: 'STORE_USER',
    }),
    (error: unknown) => error instanceof ExpiryWriteOffError && error.status === 403,
  );
  assert.throws(
    () => writeOffExpiryLot({
      itemId: 'item-1004', lotId: 'lot-1004', locationId: 'loc-1', quantity: 1, reason: 'no', actorId: 'user-admin-1', role: 'ADMIN',
    }),
    (error: unknown) => error instanceof ExpiryWriteOffError && error.status === 400,
  );
  assert.throws(
    () => writeOffExpiryLot({
      itemId: 'item-1004', lotId: 'lot-1004', locationId: 'loc-1', quantity: 999, reason: 'Expired yoghurt verified', actorId: 'user-admin-1', role: 'ADMIN',
    }),
    /exceeds current lot stock/,
  );
});

test('lot expiry and sale status can be repaired in memory', () => {
  const dated = setLotExpiryDate('lot-1006', '2026-10-01');
  assert.ok(dated.expiryDate);
  const missing = setLotExpiryDate('lot-1006', null);
  assert.equal(missing.expiryDate, null);
  const blocked = setLotSaleStatus('lot-1005', 'BLOCKED');
  assert.equal(blocked.status, 'BLOCKED');
  updateLotStatus('lot-1005', 'AVAILABLE');
  updateLotExpiry('lot-1006', null);
});
