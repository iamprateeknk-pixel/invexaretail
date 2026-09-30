import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExpiryActionRecommendations,
  buildLotBlockRecommendations,
  buildOverstockRecommendations,
  daysToExpiry,
} from './intelligence-actions.js';

const today = new Date('2026-09-15T00:00:00.000Z');

test('buildLotBlockRecommendations flags blocked lots still on hand and expired-but-available lots', () => {
  const recs = buildLotBlockRecommendations([
    { itemId: 'i1', itemName: 'Milk', lotId: 'l1', lotNo: 'L-1', locationId: 'loc-1', onHand: 6, status: 'BLOCKED' },
    { itemId: 'i2', itemName: 'Yoghurt', lotId: 'l2', lotNo: 'L-2', locationId: 'loc-1', onHand: 4, status: 'AVAILABLE', expiryDate: '2026-09-01' },
    { itemId: 'i3', itemName: 'Rice', lotId: 'l3', lotNo: 'L-3', locationId: 'loc-1', onHand: 0, status: 'BLOCKED' },
  ], today);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].suggestedAction, 'BLOCK_LOT');
  assert.equal(recs[1].itemId, 'i2');
});

test('buildExpiryActionRecommendations write-off expired lots and markdown lots inside 7 days', () => {
  const recs = buildExpiryActionRecommendations([
    { itemId: 'i1', itemName: 'Milk', lotId: 'l1', lotNo: 'L-1', locationId: 'loc-1', onHand: 2, status: 'AVAILABLE', expiryDate: '2026-09-10' },
    { itemId: 'i2', itemName: 'Bread', lotId: 'l2', lotNo: 'L-2', locationId: 'loc-1', onHand: 8, status: 'AVAILABLE', expiryDate: '2026-09-18' },
    { itemId: 'i3', itemName: 'Rice', lotId: 'l3', lotNo: 'L-3', locationId: 'loc-1', onHand: 20, status: 'AVAILABLE', expiryDate: '2027-01-01' },
  ], today);
  assert.equal(recs[0].suggestedAction, 'WRITE_OFF');
  assert.equal(recs[1].suggestedAction, 'MARKDOWN');
  assert.equal(recs.length, 2);
  assert.equal(daysToExpiry('2026-09-18', today), 3);
});

test('buildOverstockRecommendations transfers surplus to a location below min', () => {
  const recs = buildOverstockRecommendations([
    { itemId: 'i1', itemName: 'Rice', locationId: 'wh-1', locationName: 'Warehouse', onHand: 80, targetQty: 40, minQty: 10 },
    { itemId: 'i1', itemName: 'Rice', locationId: 'loc-1', locationName: 'Main Store', onHand: 2, targetQty: 20, minQty: 8 },
  ], 'wh-1');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].destinationLocationId, 'loc-1');
  assert.equal(recs[0].suggestedTransferQty, 6);
});

test('buildOverstockRecommendations stays quiet when nobody is below min', () => {
  const recs = buildOverstockRecommendations([
    { itemId: 'i1', itemName: 'Rice', locationId: 'wh-1', locationName: 'Warehouse', onHand: 80, targetQty: 40, minQty: 10 },
    { itemId: 'i1', itemName: 'Rice', locationId: 'loc-1', locationName: 'Main Store', onHand: 20, targetQty: 20, minQty: 8 },
  ], 'wh-1');
  assert.deepEqual(recs, []);
});

// Audit S-2: expiry actions should follow sell-through, not just a fixed 7-day window.
import { buildExpiryActionRecommendations as buildExpiry } from './intelligence-actions.js';

const auditNow = new Date('2026-09-26T06:30:00Z');
const lotIn = (days: number, onHand: number, itemId = 'i1') => ({
  itemId, itemName: 'Milk', lotId: `l-${days}`, lotNo: `L${days}`, locationId: 'loc', onHand, status: 'AVAILABLE',
  expiryDate: new Date(Date.UTC(2026, 8, 26 + days)).toISOString(),
});

test('a slow seller is flagged well before 7 days; a fast seller expiring soon is not', () => {
  const slow = buildExpiry([lotIn(40, 200)], auditNow, { demandByItem: new Map([['i1', 1]]) });
  assert.equal(slow.length, 1);
  assert.equal(slow[0].suggestedAction, 'MARKDOWN');
  assert.equal(slow[0].atRiskQty, 159, '200 on hand - 41 selling days x 1/day');
  const fast = buildExpiry([lotIn(3, 20)], auditNow, { demandByItem: new Map([['i1', 10]]) });
  assert.deepEqual(fast, [], 'it will sell out before it expires');
});

test('no recent sales at all means everything is at risk; unknown demand keeps the old 7-day rule; beyond 90 days is ignored', () => {
  const dead = buildExpiry([lotIn(20, 12)], auditNow, { demandByItem: new Map([['i1', 0]]) });
  assert.equal(dead[0].atRiskQty, 12);
  assert.match(dead[0].reason, /no recent sales/);
  assert.equal(buildExpiry([lotIn(5, 10)], auditNow).length, 1);
  assert.equal(buildExpiry([lotIn(30, 10)], auditNow).length, 0);
  assert.equal(buildExpiry([lotIn(200, 500)], auditNow, { demandByItem: new Map([['i1', 0]]) }).length, 0);
});

// Audit R-1: the declared TRANSFER action for expiring stock was never produced.
test('a faster-selling branch with enough shelf life left is suggested as a TRANSFER instead of MARKDOWN', () => {
  const [rec] = buildExpiry([lotIn(10, 100)], auditNow, {
    demandByItem: new Map([['i1', 1]]),
    networkByItem: new Map([['i1', [{ locationId: 'fast-store', locationName: 'Fast Store', avgDailyDemand: 20, onHand: 5 }]]]),
  });
  assert.equal(rec.suggestedAction, 'TRANSFER');
  assert.equal(rec.destinationLocationId, 'fast-store');
  // sellableDays = 10 - 2 transit buffer = 8; min(atRiskQty, 20/day x 8 days).
  assert.equal(rec.suggestedTransferQty, Math.min(rec.atRiskQty!, 160));
  assert.match(rec.reason, /transfer .* there instead of marking it down/);
});

test('TRANSFER is not suggested when the only other branch sells no faster, or there is no time left to ship it', () => {
  const noFaster = buildExpiry([lotIn(10, 100)], auditNow, {
    demandByItem: new Map([['i1', 5]]),
    networkByItem: new Map([['i1', [{ locationId: 'slower', locationName: 'Slower Store', avgDailyDemand: 3, onHand: 5 }]]]),
  });
  assert.equal(noFaster[0].suggestedAction, 'MARKDOWN', 'the other branch sells slower, not faster - no point moving it there');

  const tooSoon = buildExpiry([lotIn(2, 100)], auditNow, {
    demandByItem: new Map([['i1', 1]]),
    networkByItem: new Map([['i1', [{ locationId: 'fast-store', locationName: 'Fast Store', avgDailyDemand: 20, onHand: 5 }]]]),
  });
  assert.equal(tooSoon[0].suggestedAction, 'MARKDOWN', 'expires in 2 days, transit alone is a 2-day buffer: no sellable time left there either');
});

test('shelf-life zone is attached when the item shelf life is known; expired lots are still written off', () => {
  const [rec] = buildExpiry([lotIn(3, 10)], auditNow, { shelfLifeByItem: new Map([['i1', 365]]) });
  assert.equal(rec.shelfLifeZone, 'CRITICAL');
  const [expired] = buildExpiry([lotIn(-2, 4)], auditNow);
  assert.equal(expired.suggestedAction, 'WRITE_OFF');
  assert.equal(expired.atRiskQty, 4);
});

test('two surplus branches do not both fill the same shortage: the need is handed out once across the network', () => {
  const row = (locationId: string, onHand: number, targetQty: number, minQty: number) => ({ itemId: 'i', itemName: 'Item', locationId, locationName: locationId, onHand, targetQty, minQty });
  const rows = [row('big', 60, 40, 5), row('small', 50, 40, 5), row('needy', 2, 30, 12)];
  const forBig = buildOverstockRecommendations(rows, 'big');
  const forSmall = buildOverstockRecommendations(rows, 'small');
  assert.deepEqual(forBig.map((r) => [r.destinationLocationId, r.suggestedTransferQty]), [['needy', 10]], 'the larger surplus covers the whole 10-unit need');
  assert.deepEqual(forSmall, [], 'the need is already spoken for, so nothing is left to send');
  const withInbound = buildOverstockRecommendations(rows, 'big', new Map([['i|needy', 4]]));
  assert.equal(withInbound[0].suggestedTransferQty, 6, 'units already on their way reduce the need');
});
