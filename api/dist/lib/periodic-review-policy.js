"use strict";
// Periodic-review (R, S) policy (audit R-3): the reorder system built so far (lib/replenishment.ts,
// po-planning.ts) is all continuous-review (s, S) - it reacts to today's position whenever a screen
// is opened or an order is placed. A periodic-review policy instead checks the position on a fixed
// review cycle (R days) and, when it is at or below the reorder point, orders up to a target level
// (S) that covers demand through the NEXT review plus the lead time after it - the classic shape
// used where continuous monitoring isn't practical (a weekly buy for a supplier who only ships
// once a week, a physical count cycle). This module is deliberately scoped to ONE item at ONE
// location: a full time-phased, multi-echelon DRP that cascades requirements across the whole
// network is a further, much larger increment, not attempted here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePeriodicReviewPolicy = computePeriodicReviewPolicy;
exports.projectPeriodicReview = projectPeriodicReview;
const demand_forecast_js_1 = require("./demand-forecast.js");
/**
 * Computes the (R,S) policy's own R-day review-cycle parameters from demand/lead-time inputs -
 * the second half of "periodic review" this module was missing: projectPeriodicReview could only
 * simulate a given R/S, not derive S from real demand statistics the way computeSafetyStock
 * already does for continuous review. Same King's-formula safety stock, with the protection
 * interval (lead time + review period, not lead time alone) standing in for "lead time": between
 * one review and the arrival of the order it might trigger, nothing can be ordered again, so the
 * position must be protected for that whole stretch, not just the supplier's lead time.
 */
function computePeriodicReviewPolicy(input) {
    const demand = Math.max(0, input.avgDailyDemand);
    const protectionIntervalDays = Math.max(0, input.leadTimeDays) + Math.max(0, input.reviewPeriodDays);
    const safetyStock = (0, demand_forecast_js_1.computeSafetyStock)({
        averageDailyDemand: demand,
        stdDevDailyDemand: Math.max(0, input.stdDevDailyDemand),
        averageLeadTimeDays: protectionIntervalDays,
        leadTimeStdDevDays: input.leadTimeStdDevDays,
        servicePercent: input.servicePercent,
    });
    const orderUpToLevel = demand * protectionIntervalDays + safetyStock;
    return {
        reviewPeriodDays: input.reviewPeriodDays, leadTimeDays: input.leadTimeDays, protectionIntervalDays,
        safetyStock, orderUpToLevel, reorderPoint: orderUpToLevel,
    };
}
/**
 * Simulates one item/location under a periodic-review (R, S) policy. A review on day `d` (d = 0,
 * R, 2R, ...) orders when the OPENING position that day (before demand is removed) is at or below
 * the reorder point; the order quantity is `orderUpToLevel - openingPosition`, arriving after
 * `leadTimeDays` and added to `scheduledReceipts` for that arrival day (so a later review already
 * sees it as incoming, and never double-orders for the same need).
 */
function projectPeriodicReview(input) {
    const demand = Math.max(0, input.avgDailyDemand);
    const receiptsByDay = new Map();
    for (const receipt of input.scheduledReceipts ?? []) {
        receiptsByDay.set(receipt.day, (receiptsByDay.get(receipt.day) ?? 0) + receipt.quantity);
    }
    const days = [];
    const plannedOrders = [];
    let position = input.onHand;
    let minPosition = position;
    let firstStockoutDay = position < 0 ? 0 : null;
    for (let day = 0; day < input.horizonDays; day += 1) {
        const openingPosition = position + (receiptsByDay.get(day) ?? 0);
        position = openingPosition;
        const isReviewDay = input.reviewPeriodDays > 0 && day % input.reviewPeriodDays === 0;
        let orderedQty;
        if (isReviewDay && openingPosition <= input.reorderPoint) {
            const quantity = Math.max(0, input.orderUpToLevel - openingPosition);
            if (quantity > 0) {
                orderedQty = quantity;
                plannedOrders.push({ day, quantity });
                const arrivalDay = day + input.leadTimeDays;
                receiptsByDay.set(arrivalDay, (receiptsByDay.get(arrivalDay) ?? 0) + quantity);
            }
        }
        const closingPosition = position - demand;
        position = closingPosition;
        if (closingPosition < minPosition)
            minPosition = closingPosition;
        if (firstStockoutDay === null && closingPosition < 0)
            firstStockoutDay = day;
        days.push({ day, openingPosition, closingPosition, isReviewDay, orderedQty });
    }
    return { days, plannedOrders, firstStockoutDay, minPosition };
}
