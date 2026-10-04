"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const periodic_review_policy_js_1 = require("./periodic-review-policy.js");
const demand_forecast_js_1 = require("./demand-forecast.js");
(0, node_test_1.default)('reviews trigger only on the cycle, and order up to the target level from the opening position', () => {
    const result = (0, periodic_review_policy_js_1.projectPeriodicReview)({
        onHand: 20, avgDailyDemand: 5, leadTimeDays: 3, reviewPeriodDays: 7,
        reorderPoint: 20, orderUpToLevel: 60, horizonDays: 10,
    });
    // Day 0 is a review day; opening position 20 <= reorder point 20 -> order 40, arriving day 3.
    strict_1.default.deepEqual(result.plannedOrders, [{ day: 0, quantity: 40 }]);
    strict_1.default.equal(result.days[3].openingPosition, result.days[2].closingPosition + 40);
    // No review again until day 7 in this horizon.
    strict_1.default.equal(result.days.slice(1, 7).every((d) => !d.isReviewDay), true);
    strict_1.default.equal(result.days[7].isReviewDay, true);
});
(0, node_test_1.default)('a healthy position above the reorder point is left alone even on a review day', () => {
    const result = (0, periodic_review_policy_js_1.projectPeriodicReview)({
        onHand: 100, avgDailyDemand: 2, leadTimeDays: 5, reviewPeriodDays: 7,
        reorderPoint: 20, orderUpToLevel: 60, horizonDays: 7,
    });
    strict_1.default.deepEqual(result.plannedOrders, []);
});
(0, node_test_1.default)('a scheduled receipt already in flight is counted at review, so it is not ordered again', () => {
    const result = (0, periodic_review_policy_js_1.projectPeriodicReview)({
        onHand: 10, avgDailyDemand: 5, leadTimeDays: 3, reviewPeriodDays: 7,
        reorderPoint: 20, orderUpToLevel: 60, scheduledReceipts: [{ day: 0, quantity: 45 }], horizonDays: 7,
    });
    // Opening position on day 0 = 10 + 45 = 55, above the reorder point of 20 - no order needed.
    strict_1.default.deepEqual(result.plannedOrders, []);
    strict_1.default.equal(result.days[0].openingPosition, 55);
});
(0, node_test_1.default)('reports the first projected stockout day and the lowest position reached', () => {
    const result = (0, periodic_review_policy_js_1.projectPeriodicReview)({
        onHand: 5, avgDailyDemand: 5, leadTimeDays: 10, reviewPeriodDays: 30,
        reorderPoint: 0, orderUpToLevel: 50, horizonDays: 5,
    });
    // Day 0: opening 5, not a review day trigger issue since day 0 IS a review day but reorderPoint is 0 and opening (5) > 0, so no order.
    // Demand of 5/day drains it: day0 closing 0, day1 closing -5 (first stockout), ...
    strict_1.default.equal(result.firstStockoutDay, 1);
    strict_1.default.equal(result.minPosition, -20);
});
// The parameter calculator: deriving R/S from demand statistics, not just simulating a given R/S.
(0, node_test_1.default)('computePeriodicReviewPolicy: order-up-to is expected demand over lead time + review period, plus safety stock', () => {
    const policy = (0, periodic_review_policy_js_1.computePeriodicReviewPolicy)({
        avgDailyDemand: 10, stdDevDailyDemand: 0, leadTimeDays: 3, reviewPeriodDays: 7, servicePercent: 95,
    });
    strict_1.default.equal(policy.protectionIntervalDays, 10, 'lead time + review period, not lead time alone');
    strict_1.default.equal(policy.safetyStock, 0, 'zero demand variability: no safety stock needed');
    strict_1.default.equal(policy.orderUpToLevel, 100, '10/day x 10 protection days');
    strict_1.default.equal(policy.reorderPoint, policy.orderUpToLevel, 'textbook (R,S): order at every review unless already at/above S');
});
(0, node_test_1.default)('computePeriodicReviewPolicy: safety stock grows with demand variability, at the configured service level', () => {
    const steady = (0, periodic_review_policy_js_1.computePeriodicReviewPolicy)({ avgDailyDemand: 10, stdDevDailyDemand: 0, leadTimeDays: 3, reviewPeriodDays: 7 });
    const variable = (0, periodic_review_policy_js_1.computePeriodicReviewPolicy)({ avgDailyDemand: 10, stdDevDailyDemand: 4, leadTimeDays: 3, reviewPeriodDays: 7 });
    strict_1.default.ok(variable.safetyStock > steady.safetyStock);
    // King's formula reduces to z x stdDev x sqrt(protectionDays) with no lead-time variability.
    const z = (0, demand_forecast_js_1.serviceLevelZ)(95);
    strict_1.default.ok(Math.abs(variable.safetyStock - z * 4 * Math.sqrt(10)) < 1e-9);
});
(0, node_test_1.default)('computePeriodicReviewPolicy: a longer review period needs a higher order-up-to level, all else equal', () => {
    const weekly = (0, periodic_review_policy_js_1.computePeriodicReviewPolicy)({ avgDailyDemand: 10, stdDevDailyDemand: 2, leadTimeDays: 3, reviewPeriodDays: 7 });
    const monthly = (0, periodic_review_policy_js_1.computePeriodicReviewPolicy)({ avgDailyDemand: 10, stdDevDailyDemand: 2, leadTimeDays: 3, reviewPeriodDays: 30 });
    strict_1.default.ok(monthly.orderUpToLevel > weekly.orderUpToLevel, 'a longer gap between orders needs more stock to cover it');
});
(0, node_test_1.default)('a calculated policy run through the simulator never stocks out at steady demand', () => {
    const policy = (0, periodic_review_policy_js_1.computePeriodicReviewPolicy)({ avgDailyDemand: 8, stdDevDailyDemand: 1.5, leadTimeDays: 4, reviewPeriodDays: 7, servicePercent: 97 });
    const result = (0, periodic_review_policy_js_1.projectPeriodicReview)({
        onHand: policy.orderUpToLevel, avgDailyDemand: 8, leadTimeDays: policy.leadTimeDays,
        reviewPeriodDays: policy.reviewPeriodDays, reorderPoint: policy.reorderPoint, orderUpToLevel: policy.orderUpToLevel,
        horizonDays: 90,
    });
    strict_1.default.equal(result.firstStockoutDay, null, 'a policy sized for steady demand should not stock out under that same steady demand');
});
(0, node_test_1.default)('never stocking out when the review cycle and lead time keep pace with demand', () => {
    const result = (0, periodic_review_policy_js_1.projectPeriodicReview)({
        onHand: 50, avgDailyDemand: 5, leadTimeDays: 2, reviewPeriodDays: 7,
        reorderPoint: 25, orderUpToLevel: 90, horizonDays: 60,
    });
    strict_1.default.equal(result.firstStockoutDay, null);
    strict_1.default.ok(result.minPosition >= 0);
});
