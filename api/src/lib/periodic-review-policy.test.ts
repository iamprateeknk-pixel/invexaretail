import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPeriodicReview } from './periodic-review-policy.js';

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

test('never stocking out when the review cycle and lead time keep pace with demand', () => {
  const result = projectPeriodicReview({
    onHand: 50, avgDailyDemand: 5, leadTimeDays: 2, reviewPeriodDays: 7,
    reorderPoint: 25, orderUpToLevel: 90, horizonDays: 60,
  });
  assert.equal(result.firstStockoutDay, null);
  assert.ok(result.minPosition >= 0);
});
