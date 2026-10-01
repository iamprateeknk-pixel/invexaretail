import test from 'node:test';
import assert from 'node:assert/strict';
import { computePeriodicReviewPolicy, projectPeriodicReview } from './periodic-review-policy.js';
import { serviceLevelZ } from './demand-forecast.js';

test('reviews trigger only on the cycle, and order up to the target level from the opening position', () => {
  const result = projectPeriodicReview({
    onHand: 20, avgDailyDemand: 5, leadTimeDays: 3, reviewPeriodDays: 7,
    reorderPoint: 20, orderUpToLevel: 60, horizonDays: 10,
  });
  // Day 0 is a review day; opening position 20 <= reorder point 20 -> order 40, arriving day 3.
  assert.deepEqual(result.plannedOrders, [{ day: 0, quantity: 40 }]);
  assert.equal(result.days[3].openingPosition, result.days[2].closingPosition + 40);
  // No review again until day 7 in this horizon.
  assert.equal(result.days.slice(1, 7).every((d) => !d.isReviewDay), true);
  assert.equal(result.days[7].isReviewDay, true);
});

test('a healthy position above the reorder point is left alone even on a review day', () => {
  const result = projectPeriodicReview({
    onHand: 100, avgDailyDemand: 2, leadTimeDays: 5, reviewPeriodDays: 7,
    reorderPoint: 20, orderUpToLevel: 60, horizonDays: 7,
  });
  assert.deepEqual(result.plannedOrders, []);
});

test('a scheduled receipt already in flight is counted at review, so it is not ordered again', () => {
  const result = projectPeriodicReview({
    onHand: 10, avgDailyDemand: 5, leadTimeDays: 3, reviewPeriodDays: 7,
    reorderPoint: 20, orderUpToLevel: 60, scheduledReceipts: [{ day: 0, quantity: 45 }], horizonDays: 7,
  });
  // Opening position on day 0 = 10 + 45 = 55, above the reorder point of 20 - no order needed.
  assert.deepEqual(result.plannedOrders, []);
  assert.equal(result.days[0].openingPosition, 55);
});

test('reports the first projected stockout day and the lowest position reached', () => {
  const result = projectPeriodicReview({
    onHand: 5, avgDailyDemand: 5, leadTimeDays: 10, reviewPeriodDays: 30,
    reorderPoint: 0, orderUpToLevel: 50, horizonDays: 5,
  });
  // Day 0: opening 5, not a review day trigger issue since day 0 IS a review day but reorderPoint is 0 and opening (5) > 0, so no order.
  // Demand of 5/day drains it: day0 closing 0, day1 closing -5 (first stockout), ...
  assert.equal(result.firstStockoutDay, 1);
  assert.equal(result.minPosition, -20);
});

// The parameter calculator: deriving R/S from demand statistics, not just simulating a given R/S.
test('computePeriodicReviewPolicy: order-up-to is expected demand over lead time + review period, plus safety stock', () => {
  const policy = computePeriodicReviewPolicy({
    avgDailyDemand: 10, stdDevDailyDemand: 0, leadTimeDays: 3, reviewPeriodDays: 7, servicePercent: 95,
  });
  assert.equal(policy.protectionIntervalDays, 10, 'lead time + review period, not lead time alone');
  assert.equal(policy.safetyStock, 0, 'zero demand variability: no safety stock needed');
  assert.equal(policy.orderUpToLevel, 100, '10/day x 10 protection days');
  assert.equal(policy.reorderPoint, policy.orderUpToLevel, 'textbook (R,S): order at every review unless already at/above S');
});

test('computePeriodicReviewPolicy: safety stock grows with demand variability, at the configured service level', () => {
  const steady = computePeriodicReviewPolicy({ avgDailyDemand: 10, stdDevDailyDemand: 0, leadTimeDays: 3, reviewPeriodDays: 7 });
  const variable = computePeriodicReviewPolicy({ avgDailyDemand: 10, stdDevDailyDemand: 4, leadTimeDays: 3, reviewPeriodDays: 7 });
  assert.ok(variable.safetyStock > steady.safetyStock);
  // King's formula reduces to z x stdDev x sqrt(protectionDays) with no lead-time variability.
  const z = serviceLevelZ(95);
  assert.ok(Math.abs(variable.safetyStock - z * 4 * Math.sqrt(10)) < 1e-9);
});

test('computePeriodicReviewPolicy: a longer review period needs a higher order-up-to level, all else equal', () => {
  const weekly = computePeriodicReviewPolicy({ avgDailyDemand: 10, stdDevDailyDemand: 2, leadTimeDays: 3, reviewPeriodDays: 7 });
  const monthly = computePeriodicReviewPolicy({ avgDailyDemand: 10, stdDevDailyDemand: 2, leadTimeDays: 3, reviewPeriodDays: 30 });
  assert.ok(monthly.orderUpToLevel > weekly.orderUpToLevel, 'a longer gap between orders needs more stock to cover it');
});

test('a calculated policy run through the simulator never stocks out at steady demand', () => {
  const policy = computePeriodicReviewPolicy({ avgDailyDemand: 8, stdDevDailyDemand: 1.5, leadTimeDays: 4, reviewPeriodDays: 7, servicePercent: 97 });
  const result = projectPeriodicReview({
    onHand: policy.orderUpToLevel, avgDailyDemand: 8, leadTimeDays: policy.leadTimeDays,
    reviewPeriodDays: policy.reviewPeriodDays, reorderPoint: policy.reorderPoint, orderUpToLevel: policy.orderUpToLevel,
    horizonDays: 90,
  });
  assert.equal(result.firstStockoutDay, null, 'a policy sized for steady demand should not stock out under that same steady demand');
});

test('never stocking out when the review cycle and lead time keep pace with demand', () => {
  const result = projectPeriodicReview({
    onHand: 50, avgDailyDemand: 5, leadTimeDays: 2, reviewPeriodDays: 7,
    reorderPoint: 25, orderUpToLevel: 90, horizonDays: 60,
  });
  assert.equal(result.firstStockoutDay, null);
  assert.ok(result.minPosition >= 0);
});
