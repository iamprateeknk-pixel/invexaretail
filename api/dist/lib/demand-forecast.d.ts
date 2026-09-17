export type DemandStats = {
    averageDailyDemand: number;
    stdDevDailyDemand: number;
    sampleDays: number;
};
/**
 * dailyDemand: units sold per day over the observation window (zeros for
 * no-sale days included, so a slow mover's average is genuinely low, not
 * inflated by only counting days it sold).
 */
export declare function computeDemandStats(dailyDemand: number[]): DemandStats;
export declare function forecastDemand(averageDailyDemand: number, days: number): number;
export declare function serviceLevelZ(servicePercent: number): number;
/**
 * King's formula: accounts for variability in both daily demand and lead
 * time. leadTimeStdDevDays defaults to 0 (a fixed lead time), which reduces
 * this to the simpler z * stdDev * sqrt(leadTime) form.
 */
export declare function computeSafetyStock(input: {
    averageDailyDemand: number;
    stdDevDailyDemand: number;
    averageLeadTimeDays: number;
    leadTimeStdDevDays?: number;
    servicePercent?: number;
}): number;
/**
 * null means "won't stock out on current trend" (zero or negative demand),
 * not zero days - those are very different states for a reorder screen.
 */
export declare function computeDaysCover(onHand: number, averageDailyDemand: number): number | null;
export declare function projectedStockoutDate(onHand: number, averageDailyDemand: number, from?: Date): string | null;
export type ReplenishmentSuggestion = {
    averageDailyDemand: number;
    daysCover: number | null;
    safetyStock: number;
    reorderPoint: number;
    suggestedOrderQty: number;
    stockoutDate: string | null;
};
/**
 * Ties the pieces above into one reorder suggestion: reorder point is
 * safety stock plus expected demand during lead time; suggested quantity
 * tops on-hand + on-order back up to that point plus one lead time's worth
 * of cover, never negative.
 */
export declare function suggestReplenishment(input: {
    onHand: number;
    onOrder: number;
    demand: DemandStats;
    averageLeadTimeDays: number;
    leadTimeStdDevDays?: number;
    servicePercent?: number;
}): ReplenishmentSuggestion;
