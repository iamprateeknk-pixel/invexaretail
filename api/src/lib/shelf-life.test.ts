import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSellThrough, remainingShelfLifePercent, shelfLifeZone } from './shelf-life.js';

test('zones are relative to the product\'s own shelf life, not a fixed day count', () => {
  // 3 days left: a 5-day product is at 60% (yellow) but a 365-day product is critical.
  assert.equal(shelfLifeZone(3, 5), 'YELLOW');
  assert.equal(shelfLifeZone(3, 365), 'CRITICAL');
  assert.equal(shelfLifeZone(70, 100), 'GREEN');
  assert.equal(shelfLifeZone(67, 100), 'YELLOW');
  assert.equal(shelfLifeZone(20, 100), 'RED');
  assert.equal(shelfLifeZone(10, 100), 'CRITICAL');
  assert.equal(shelfLifeZone(-1, 100), 'EXPIRED');
  assert.equal(shelfLifeZone(5, null), null, 'unknown shelf life gives no zone rather than a guess');
  assert.equal(shelfLifeZone(-1, null), 'EXPIRED');
  assert.equal(remainingShelfLifePercent(30, 120), 25);
});

test('sell-through: stock that will not sell before expiry is at risk', () => {
  // 100 units, 2/day, 10 days left -> window 11 days -> sells 22, 78 at risk.
  const risky = projectSellThrough({ onHand: 100, avgDailyDemand: 2, daysUntilExpiry: 10 });
  assert.equal(risky.expectedSoldBeforeExpiry, 22);
  assert.equal(risky.atRiskQty, 78);
  assert.equal(risky.willSellOut, false);
  assert.equal(risky.daysToSellOut, 50);
});

test('sell-through: fast movers are safe, no demand means everything is at risk, expiring today gets one selling day', () => {
  assert.equal(projectSellThrough({ onHand: 20, avgDailyDemand: 5, daysUntilExpiry: 10 }).willSellOut, true);
  const dead = projectSellThrough({ onHand: 12, avgDailyDemand: 0, daysUntilExpiry: 30 });
  assert.equal(dead.atRiskQty, 12);
  assert.equal(dead.daysToSellOut, null);
  assert.equal(projectSellThrough({ onHand: 9, avgDailyDemand: 3, daysUntilExpiry: 0 }).atRiskQty, 6);
});
