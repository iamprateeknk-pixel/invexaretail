"use strict";
// Blueprint P8 "Forecasting, replenishment and Action Center 2.0". Per
// §8's explicit rule - "use deterministic calculations first, add ML only
// where it improves measurable accuracy, every recommendation must show why
// it was generated" - this is plain statistics over the item's own sales
// history: no model, no training, every number traces back to an input the
// caller can see.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDemandStats = computeDemandStats;
exports.forecastDemand = forecastDemand;
exports.serviceLevelZ = serviceLevelZ;
exports.computeSafetyStock = computeSafetyStock;
exports.computeDaysCover = computeDaysCover;
exports.projectedStockoutDate = projectedStockoutDate;
exports.suggestReplenishment = suggestReplenishment;
/**
 * dailyDemand: units sold per day over the observation window (zeros for
 * no-sale days included, so a slow mover's average is genuinely low, not
 * inflated by only counting days it sold).
 */
function computeDemandStats(dailyDemand) {
    const sampleDays = dailyDemand.length;
    if (sampleDays === 0)
        return { averageDailyDemand: 0, stdDevDailyDemand: 0, sampleDays: 0 };
    const averageDailyDemand = dailyDemand.reduce((sum, value) => sum + value, 0) / sampleDays;
    const variance = dailyDemand.reduce((sum, value) => sum + (value - averageDailyDemand) ** 2, 0) / sampleDays;
    return { averageDailyDemand, stdDevDailyDemand: Math.sqrt(variance), sampleDays };
}
function forecastDemand(averageDailyDemand, days) {
    return averageDailyDemand * days;
}
// Standard normal z-scores for common service levels - a fixed lookup
// table, not a fitted/learned value, so a chosen service level always maps
// to the same safety stock for the same demand history.
const SERVICE_LEVEL_Z = {
    90: 1.2816,
    95: 1.6449,
    98: 2.0537,
    99: 2.3263,
    99.5: 2.5758,
};
function serviceLevelZ(servicePercent) {
    return SERVICE_LEVEL_Z[servicePercent] ?? SERVICE_LEVEL_Z[95];
}
/**
 * King's formula: accounts for variability in both daily demand and lead
 * time. leadTimeStdDevDays defaults to 0 (a fixed lead time), which reduces
 * this to the simpler z * stdDev * sqrt(leadTime) form.
 */
function computeSafetyStock(input) {
    const leadTimeStdDevDays = input.leadTimeStdDevDays ?? 0;
    const z = serviceLevelZ(input.servicePercent ?? 95);
    const demandVarianceTerm = input.averageLeadTimeDays * input.stdDevDailyDemand ** 2;
    const leadTimeVarianceTerm = input.averageDailyDemand ** 2 * leadTimeStdDevDays ** 2;
    return z * Math.sqrt(Math.max(0, demandVarianceTerm + leadTimeVarianceTerm));
}
/**
 * null means "won't stock out on current trend" (zero or negative demand),
 * not zero days - those are very different states for a reorder screen.
 */
function computeDaysCover(onHand, averageDailyDemand) {
    if (averageDailyDemand <= 0)
        return null;
    return Math.max(0, onHand / averageDailyDemand);
}
function projectedStockoutDate(onHand, averageDailyDemand, from = new Date()) {
    const daysCover = computeDaysCover(onHand, averageDailyDemand);
    if (daysCover === null)
        return null;
    return new Date(from.getTime() + daysCover * 24 * 60 * 60 * 1000).toISOString();
}
/**
 * Ties the pieces above into one reorder suggestion: reorder point is
 * safety stock plus expected demand during lead time; suggested quantity
 * tops on-hand + on-order back up to that point plus one lead time's worth
 * of cover, never negative.
 */
function suggestReplenishment(input) {
    const safetyStock = computeSafetyStock({
        averageDailyDemand: input.demand.averageDailyDemand,
        stdDevDailyDemand: input.demand.stdDevDailyDemand,
        averageLeadTimeDays: input.averageLeadTimeDays,
        leadTimeStdDevDays: input.leadTimeStdDevDays,
        servicePercent: input.servicePercent,
    });
    const demandDuringLeadTime = forecastDemand(input.demand.averageDailyDemand, input.averageLeadTimeDays);
    const reorderPoint = safetyStock + demandDuringLeadTime;
    const target = reorderPoint + demandDuringLeadTime;
    const position = input.onHand + input.onOrder;
    const suggestedOrderQty = Math.max(0, target - position);
    return {
        averageDailyDemand: input.demand.averageDailyDemand,
        daysCover: computeDaysCover(input.onHand, input.demand.averageDailyDemand),
        safetyStock,
        reorderPoint,
        suggestedOrderQty,
        stockoutDate: projectedStockoutDate(input.onHand, input.demand.averageDailyDemand),
    };
}
