"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestReorderRule = suggestReorderRule;
// Computed reorder-rule suggestions (audit O-1). Reorder rules were hand-typed only; this derives
// a suggested min (reorder point) and target (order-up-to) from demand, lead time and a service
// level, so a human can accept or ignore it. Read-only: nothing here writes a rule.
const demand_forecast_js_1 = require("./demand-forecast.js");
const CHANGE_TOLERANCE = 0.25;
function suggestReorderRule(input) {
    const demand = input.dailyDemand.map((value) => Math.max(0, value));
    if (demand.every((value) => value === 0))
        return null; // no demand history: nothing to derive a rule from
    const stats = (0, demand_forecast_js_1.computeDemandStats)(demand);
    const { pattern } = (0, demand_forecast_js_1.classifyDemandPattern)(demand);
    const average = pattern === 'INTERMITTENT' || pattern === 'LUMPY' ? (0, demand_forecast_js_1.crostonDailyDemand)(demand) : stats.averageDailyDemand;
    const safetyStock = (0, demand_forecast_js_1.computeSafetyStock)({
        averageDailyDemand: average,
        stdDevDailyDemand: stats.stdDevDailyDemand,
        averageLeadTimeDays: input.leadTimeDays,
        leadTimeStdDevDays: input.leadTimeStdDevDays,
        servicePercent: input.servicePercent,
    });
    const round = (value) => (input.decimal ? Math.round(value * 1000) / 1000 : Math.ceil(value));
    const suggestedMin = round(average * input.leadTimeDays + safetyStock);
    const suggestedTarget = Math.max(suggestedMin, round(suggestedMin + average * (input.coverDays ?? 7)));
    const currentMin = input.currentMin ?? null;
    const currentTarget = input.currentTarget ?? null;
    let change = 'NEW';
    if (currentMin !== null && currentTarget !== null) {
        const drift = (suggestedTarget - currentTarget) / Math.max(1, currentTarget);
        change = drift > CHANGE_TOLERANCE ? 'INCREASE' : drift < -CHANGE_TOLERANCE ? 'DECREASE' : 'OK';
    }
    return { itemId: input.itemId, demandPattern: pattern, averageDailyDemand: Math.round(average * 1000) / 1000, safetyStock: Math.round(safetyStock * 1000) / 1000, suggestedMin, suggestedTarget, currentMin, currentTarget, change };
}
