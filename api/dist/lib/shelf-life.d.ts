export type ShelfLifeZone = 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL' | 'EXPIRED';
/** Percentage of the product's total shelf life still remaining (0-100+), or null when the shelf life is unknown. */
export declare function remainingShelfLifePercent(daysUntilExpiry: number, shelfLifeDays: number | null | undefined): number | null;
/** Zones from the shelf-life framework: >67% green, 33-67% yellow, 10-33% red, under 10% critical, past date expired. */
export declare function shelfLifeZone(daysUntilExpiry: number, shelfLifeDays: number | null | undefined): ShelfLifeZone | null;
export type SellThroughProjection = {
    expectedSoldBeforeExpiry: number;
    atRiskQty: number;
    /** Days to sell the whole lot at the current rate, or null with no demand. */
    daysToSellOut: number | null;
    willSellOut: boolean;
};
/**
 * Will this quantity sell before its expiry date? `avgDailyDemand` is the item's recent daily
 * sales at this location; the lot is assumed to be the one sold first (FEFO), so the whole
 * daily demand is applied to it. Usable through the expiry day, so the selling window is
 * `daysUntilExpiry + 1` days.
 */
export declare function projectSellThrough(input: {
    onHand: number;
    avgDailyDemand: number;
    daysUntilExpiry: number;
}): SellThroughProjection;
