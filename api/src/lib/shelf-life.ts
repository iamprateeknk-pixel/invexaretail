// Shelf-life analytics (audit S-1/S-2). Two things the fixed 7/30/90-day horizons could not say:
//  1. how much of a product's life is LEFT (a 5-day dairy lot at day 3 is in trouble; a 3-year
//     pharma lot with 5 days left is a very different thing) - remaining-shelf-life zones;
//  2. whether the stock will actually SELL before it expires - the sell-through projection that
//     turns "expires in 20 days" into "you will still hold 35 units when it does".

export type ShelfLifeZone = 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL' | 'EXPIRED';

/** Percentage of the product's total shelf life still remaining (0-100+), or null when the shelf life is unknown. */
export function remainingShelfLifePercent(daysUntilExpiry: number, shelfLifeDays: number | null | undefined): number | null {
  if (!shelfLifeDays || shelfLifeDays <= 0) return null;
  return (daysUntilExpiry / shelfLifeDays) * 100;
}

/** Zones from the shelf-life framework: >67% green, 33-67% yellow, 10-33% red, under 10% critical, past date expired. */
export function shelfLifeZone(daysUntilExpiry: number, shelfLifeDays: number | null | undefined): ShelfLifeZone | null {
  if (daysUntilExpiry < 0) return 'EXPIRED';
  const pct = remainingShelfLifePercent(daysUntilExpiry, shelfLifeDays);
  if (pct === null) return null;
  if (pct > 67) return 'GREEN';
  if (pct > 33) return 'YELLOW';
  if (pct > 10) return 'RED';
  return 'CRITICAL';
}

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
export function projectSellThrough(input: { onHand: number; avgDailyDemand: number; daysUntilExpiry: number }): SellThroughProjection {
  const onHand = Math.max(0, input.onHand);
  const demand = Math.max(0, input.avgDailyDemand);
  const window = Math.max(0, input.daysUntilExpiry + 1);
  const expectedSold = Math.min(onHand, demand * window);
  const atRisk = Math.max(0, onHand - expectedSold);
  return {
    expectedSoldBeforeExpiry: Math.round(expectedSold * 1000) / 1000,
    atRiskQty: Math.round(atRisk * 1000) / 1000,
    daysToSellOut: demand > 0 ? Math.round((onHand / demand) * 10) / 10 : null,
    willSellOut: atRisk <= 1e-9,
  };
}
