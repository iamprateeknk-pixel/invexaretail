import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDemandStats,
  forecastDemand,
  serviceLevelZ,
  computeSafetyStock,
  computeDaysCover,
  projectedStockoutDate,
  suggestReplenishment,
} from './demand-forecast.js';

test('demand stats over an empty history is zero, not NaN or a crash', () => {
  const stats = computeDemandStats([]);
  assert.deepEqual(stats, { averageDailyDemand: 0, stdDevDailyDemand: 0, sampleDays: 0 });
});

test('a flat, constant daily demand has zero standard deviation', () => {
  const stats = computeDemandStats([5, 5, 5, 5, 5]);
  assert.equal(stats.averageDailyDemand, 5);
  assert.equal(stats.stdDevDailyDemand, 0);
});

test('zero-sale days pull the average down, not get excluded', () => {
  const stats = computeDemandStats([10, 0, 10, 0]);
  assert.equal(stats.averageDailyDemand, 5);
});

test('forecastDemand scales average demand linearly by days', () => {
  assert.equal(forecastDemand(4, 7), 28);
});

test('a higher service level uses a larger z-score, and an unknown level falls back to 95%', () => {
  assert.ok(serviceLevelZ(99) > serviceLevelZ(90));
  assert.equal(serviceLevelZ(12345), serviceLevelZ(95));
});

test('safety stock grows with demand variability and with lead time', () => {
  const stable = computeSafetyStock({ averageDailyDemand: 10, stdDevDailyDemand: 1, averageLeadTimeDays: 7 });
  const volatile = computeSafetyStock({ averageDailyDemand: 10, stdDevDailyDemand: 5, averageLeadTimeDays: 7 });
  assert.ok(volatile > stable);

  const shortLead = computeSafetyStock({ averageDailyDemand: 10, stdDevDailyDemand: 2, averageLeadTimeDays: 3 });
  const longLead = computeSafetyStock({ averageDailyDemand: 10, stdDevDailyDemand: 2, averageLeadTimeDays: 14 });
  assert.ok(longLead > shortLead);
});

test('safety stock is zero when demand is perfectly steady and lead time has no variance', () => {
  const result = computeSafetyStock({ averageDailyDemand: 10, stdDevDailyDemand: 0, averageLeadTimeDays: 7 });
  assert.equal(result, 0);
});

test('days cover is on-hand divided by average daily demand', () => {
  assert.equal(computeDaysCover(100, 10), 10);
});

test('an item with zero demand never "stocks out" on current trend - null, not zero', () => {
  assert.equal(computeDaysCover(100, 0), null);
  assert.equal(projectedStockoutDate(100, 0), null);
});

test('projected stockout date is today plus the days-cover figure', () => {
  const from = new Date('2026-09-16T00:00:00.000Z');
  const result = projectedStockoutDate(20, 5, from);
  assert.equal(result, new Date(from.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString());
});

test('suggestReplenishment recommends zero when on-hand + on-order already covers the target', () => {
  const result = suggestReplenishment({
    onHand: 1000, onOrder: 0,
    demand: { averageDailyDemand: 1, stdDevDailyDemand: 0, sampleDays: 30 },
    averageLeadTimeDays: 7,
  });
  assert.equal(result.suggestedOrderQty, 0);
});

test('suggestReplenishment recommends a positive quantity when stock is below the reorder point', () => {
  const result = suggestReplenishment({
    onHand: 5, onOrder: 0,
    demand: { averageDailyDemand: 10, stdDevDailyDemand: 2, sampleDays: 30 },
    averageLeadTimeDays: 7,
  });
  assert.ok(result.suggestedOrderQty > 0);
  assert.ok(result.reorderPoint > result.safetyStock, 'reorder point must include lead-time demand on top of safety stock');
});

test('on-order stock reduces the suggested order quantity', () => {
  const withoutOnOrder = suggestReplenishment({
    onHand: 5, onOrder: 0,
    demand: { averageDailyDemand: 10, stdDevDailyDemand: 2, sampleDays: 30 },
    averageLeadTimeDays: 7,
  });
  const withOnOrder = suggestReplenishment({
    onHand: 5, onOrder: 50,
    demand: { averageDailyDemand: 10, stdDevDailyDemand: 2, sampleDays: 30 },
    averageLeadTimeDays: 7,
  });
  assert.ok(withOnOrder.suggestedOrderQty < withoutOnOrder.suggestedOrderQty);
});
