"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const demand_forecast_js_1 = require("./demand-forecast.js");
(0, node_test_1.default)('demand stats over an empty history is zero, not NaN or a crash', () => {
    const stats = (0, demand_forecast_js_1.computeDemandStats)([]);
    strict_1.default.deepEqual(stats, { averageDailyDemand: 0, stdDevDailyDemand: 0, sampleDays: 0 });
});
(0, node_test_1.default)('a flat, constant daily demand has zero standard deviation', () => {
    const stats = (0, demand_forecast_js_1.computeDemandStats)([5, 5, 5, 5, 5]);
    strict_1.default.equal(stats.averageDailyDemand, 5);
    strict_1.default.equal(stats.stdDevDailyDemand, 0);
});
(0, node_test_1.default)('zero-sale days pull the average down, not get excluded', () => {
    const stats = (0, demand_forecast_js_1.computeDemandStats)([10, 0, 10, 0]);
    strict_1.default.equal(stats.averageDailyDemand, 5);
});
(0, node_test_1.default)('forecastDemand scales average demand linearly by days', () => {
    strict_1.default.equal((0, demand_forecast_js_1.forecastDemand)(4, 7), 28);
});
(0, node_test_1.default)('a higher service level uses a larger z-score, and an unknown level falls back to 95%', () => {
    strict_1.default.ok((0, demand_forecast_js_1.serviceLevelZ)(99) > (0, demand_forecast_js_1.serviceLevelZ)(90));
    strict_1.default.equal((0, demand_forecast_js_1.serviceLevelZ)(12345), (0, demand_forecast_js_1.serviceLevelZ)(95));
});
(0, node_test_1.default)('safety stock grows with demand variability and with lead time', () => {
    const stable = (0, demand_forecast_js_1.computeSafetyStock)({ averageDailyDemand: 10, stdDevDailyDemand: 1, averageLeadTimeDays: 7 });
    const volatile = (0, demand_forecast_js_1.computeSafetyStock)({ averageDailyDemand: 10, stdDevDailyDemand: 5, averageLeadTimeDays: 7 });
    strict_1.default.ok(volatile > stable);
    const shortLead = (0, demand_forecast_js_1.computeSafetyStock)({ averageDailyDemand: 10, stdDevDailyDemand: 2, averageLeadTimeDays: 3 });
    const longLead = (0, demand_forecast_js_1.computeSafetyStock)({ averageDailyDemand: 10, stdDevDailyDemand: 2, averageLeadTimeDays: 14 });
    strict_1.default.ok(longLead > shortLead);
});
(0, node_test_1.default)('safety stock is zero when demand is perfectly steady and lead time has no variance', () => {
    const result = (0, demand_forecast_js_1.computeSafetyStock)({ averageDailyDemand: 10, stdDevDailyDemand: 0, averageLeadTimeDays: 7 });
    strict_1.default.equal(result, 0);
});
(0, node_test_1.default)('days cover is on-hand divided by average daily demand', () => {
    strict_1.default.equal((0, demand_forecast_js_1.computeDaysCover)(100, 10), 10);
});
(0, node_test_1.default)('an item with zero demand never "stocks out" on current trend - null, not zero', () => {
    strict_1.default.equal((0, demand_forecast_js_1.computeDaysCover)(100, 0), null);
    strict_1.default.equal((0, demand_forecast_js_1.projectedStockoutDate)(100, 0), null);
});
(0, node_test_1.default)('projected stockout date is today plus the days-cover figure', () => {
    const from = new Date('2026-09-16T00:00:00.000Z');
    const result = (0, demand_forecast_js_1.projectedStockoutDate)(20, 5, from);
    strict_1.default.equal(result, new Date(from.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString());
});
(0, node_test_1.default)('suggestReplenishment recommends zero when on-hand + on-order already covers the target', () => {
    const result = (0, demand_forecast_js_1.suggestReplenishment)({
        onHand: 1000, onOrder: 0,
        demand: { averageDailyDemand: 1, stdDevDailyDemand: 0, sampleDays: 30 },
        averageLeadTimeDays: 7,
    });
    strict_1.default.equal(result.suggestedOrderQty, 0);
});
(0, node_test_1.default)('suggestReplenishment recommends a positive quantity when stock is below the reorder point', () => {
    const result = (0, demand_forecast_js_1.suggestReplenishment)({
        onHand: 5, onOrder: 0,
        demand: { averageDailyDemand: 10, stdDevDailyDemand: 2, sampleDays: 30 },
        averageLeadTimeDays: 7,
    });
    strict_1.default.ok(result.suggestedOrderQty > 0);
    strict_1.default.ok(result.reorderPoint > result.safetyStock, 'reorder point must include lead-time demand on top of safety stock');
});
(0, node_test_1.default)('on-order stock reduces the suggested order quantity', () => {
    const withoutOnOrder = (0, demand_forecast_js_1.suggestReplenishment)({
        onHand: 5, onOrder: 0,
        demand: { averageDailyDemand: 10, stdDevDailyDemand: 2, sampleDays: 30 },
        averageLeadTimeDays: 7,
    });
    const withOnOrder = (0, demand_forecast_js_1.suggestReplenishment)({
        onHand: 5, onOrder: 50,
        demand: { averageDailyDemand: 10, stdDevDailyDemand: 2, sampleDays: 30 },
        averageLeadTimeDays: 7,
    });
    strict_1.default.ok(withOnOrder.suggestedOrderQty < withoutOnOrder.suggestedOrderQty);
});
