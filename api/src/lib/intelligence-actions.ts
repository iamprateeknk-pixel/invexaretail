// Blueprint §17.1 Intelligence Action Center: replenishment and count
// variance already have accept/dismiss. These additional recommendation
// engines produce the next named actions: block a compromised lot, act on
// expiry, and redistribute overstock. They are pure so GET /intelligence
// can attach them without a new persistence model - dismiss still goes
// through IntelligenceDismissal with the new type strings.

import { daysUntilExpiryDate, isExpiredOn } from './expiry-date.js';
import { projectSellThrough, shelfLifeZone, type ShelfLifeZone } from './shelf-life.js';

export type LotBlockRecommendation = {
  type: 'LOT_BLOCK';
  itemId: string;
  itemName: string;
  lotId: string;
  lotNo: string;
  locationId: string;
  onHand: number;
  suggestedAction: 'BLOCK_LOT';
  reason: string;
  risk: 'CRITICAL' | 'HIGH';
};

export type ExpiryActionRecommendation = {
  type: 'EXPIRY';
  itemId: string;
  itemName: string;
  lotId: string;
  lotNo: string;
  locationId: string;
  onHand: number;
  daysToExpiry: number | null;
  suggestedAction: 'MARKDOWN' | 'WRITE_OFF' | 'TRANSFER';
  reason: string;
  risk: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  /** Units projected to still be unsold on the expiry date (only when the item's sales rate is known). */
  atRiskQty?: number;
  /** Remaining-shelf-life zone (only when the item's shelf life is known). */
  shelfLifeZone?: ShelfLifeZone | null;
};

export type OverstockRecommendation = {
  type: 'OVERSTOCK';
  itemId: string;
  itemName: string;
  locationId: string;
  onHand: number;
  targetQty: number;
  surplusQty: number;
  suggestedAction: 'TRANSFER';
  destinationLocationId: string;
  destinationLocationName: string;
  suggestedTransferQty: number;
  reason: string;
  risk: 'HIGH' | 'MEDIUM';
};

export type LotBlockInput = {
  itemId: string;
  itemName: string;
  lotId: string;
  lotNo: string;
  locationId: string;
  onHand: number;
  status: string;
  expiryDate?: string | null;
};

export function buildLotBlockRecommendations(lots: LotBlockInput[], today = new Date()): LotBlockRecommendation[] {
  return lots
    .filter((lot) => lot.onHand > 0)
    .flatMap((lot) => {
      const expired = isExpiredOn(lot.expiryDate, today);
      if (lot.status === 'BLOCKED' || lot.status === 'QUARANTINE') {
        return [{
          type: 'LOT_BLOCK' as const,
          itemId: lot.itemId,
          itemName: lot.itemName,
          lotId: lot.lotId,
          lotNo: lot.lotNo,
          locationId: lot.locationId,
          onHand: lot.onHand,
          suggestedAction: 'BLOCK_LOT' as const,
          reason: `${lot.lotNo} is ${lot.status.toLowerCase()} with ${lot.onHand} still on hand - keep it unsellable.`,
          risk: 'CRITICAL' as const,
        }];
      }
      if (expired && lot.status !== 'EXPIRED') {
        return [{
          type: 'LOT_BLOCK' as const,
          itemId: lot.itemId,
          itemName: lot.itemName,
          lotId: lot.lotId,
          lotNo: lot.lotNo,
          locationId: lot.locationId,
          onHand: lot.onHand,
          suggestedAction: 'BLOCK_LOT' as const,
          reason: `${lot.lotNo} is past expiry with ${lot.onHand} on hand - block the lot before it can be sold.`,
          risk: 'CRITICAL' as const,
        }];
      }
      return [];
    });
}

export function daysToExpiry(expiryDate: string | null | undefined, today = new Date()): number | null {
  return daysUntilExpiryDate(expiryDate, today);
}

export type ExpiryActionContext = {
  /** Average units sold per day at this location, by item. Presence of the item enables sell-through projection. */
  demandByItem?: Map<string, number>;
  shelfLifeByItem?: Map<string, number | null | undefined>;
};

/**
 * Expiry actions (audit S-1/S-2). With a known sales rate the question is not "how many days are
 * left" but "will it sell before then": a lot that expires in 40 days but sells 1 unit a day
 * against 200 on hand is a markdown candidate today, and a lot expiring in 3 days that will sell
 * out is not. Without a sales rate we keep the old fixed rule (7 days). Shelf-life zones are added
 * whenever the item's shelf life is known.
 */
export function buildExpiryActionRecommendations(lots: LotBlockInput[], today = new Date(), context: ExpiryActionContext = {}): ExpiryActionRecommendation[] {
  const recs: ExpiryActionRecommendation[] = [];
  for (const lot of lots) {
    if (!(lot.onHand > 0)) continue;
    const days = daysToExpiry(lot.expiryDate, today);
    if (days === null) continue;
    const zone = shelfLifeZone(days, context.shelfLifeByItem?.get(lot.itemId));
    const base = {
      type: 'EXPIRY' as const, itemId: lot.itemId, itemName: lot.itemName, lotId: lot.lotId, lotNo: lot.lotNo,
      locationId: lot.locationId, onHand: lot.onHand, daysToExpiry: days, shelfLifeZone: zone,
    };
    if (days < 0) {
      recs.push({
        ...base, suggestedAction: 'WRITE_OFF', atRiskQty: lot.onHand,
        reason: `${lot.lotNo} expired ${Math.abs(days)} day(s) ago - write off remaining ${lot.onHand}.`,
        risk: 'CRITICAL',
      });
      continue;
    }
    const demand = context.demandByItem?.get(lot.itemId);
    if (demand !== undefined) {
      const projection = projectSellThrough({ onHand: lot.onHand, avgDailyDemand: demand, daysUntilExpiry: days });
      if (projection.willSellOut || days > 90) continue;
      const share = projection.atRiskQty / lot.onHand;
      recs.push({
        ...base, suggestedAction: 'MARKDOWN', atRiskQty: projection.atRiskQty,
        reason: demand > 0
          ? `${lot.lotNo} expires in ${days} day(s) and sells about ${demand}/day: ~${projection.atRiskQty} of ${lot.onHand} will still be unsold - markdown or move it to a faster-selling branch.`
          : `${lot.lotNo} expires in ${days} day(s) with no recent sales - all ${lot.onHand} are at risk; markdown, move or donate.`,
        risk: days <= 7 || (share >= 0.5 && days <= 21) ? 'HIGH' : 'MEDIUM',
      });
      continue;
    }
    if (days <= 7) {
      recs.push({
        ...base, suggestedAction: 'MARKDOWN',
        reason: `${lot.lotNo} expires in ${days} day(s) - markdown or move before it becomes waste.`,
        risk: days <= 2 ? 'HIGH' : 'MEDIUM',
      });
    }
  }
  return recs;
}

export type OverstockInput = {
  itemId: string;
  itemName: string;
  locationId: string;
  locationName: string;
  onHand: number;
  targetQty: number;
  minQty: number;
};

export function buildOverstockRecommendations(
  rows: OverstockInput[],
  currentLocationId: string,
): OverstockRecommendation[] {
  const here = rows.filter((row) => row.locationId === currentLocationId && row.onHand > row.targetQty && row.targetQty > 0);
  const needy = rows.filter((row) => row.locationId !== currentLocationId && row.onHand < row.minQty);
  return here.flatMap((surplus) => {
    const surplusQty = surplus.onHand - surplus.targetQty;
    const destination = needy
      .filter((row) => row.itemId === surplus.itemId)
      .sort((a, b) => (a.onHand - a.minQty) - (b.onHand - b.minQty))[0];
    if (!destination) return [];
    const need = destination.minQty - destination.onHand;
    const suggestedTransferQty = Math.min(surplusQty, need);
    if (suggestedTransferQty <= 0) return [];
    return [{
      type: 'OVERSTOCK' as const,
      itemId: surplus.itemId,
      itemName: surplus.itemName,
      locationId: surplus.locationId,
      onHand: surplus.onHand,
      targetQty: surplus.targetQty,
      surplusQty,
      suggestedAction: 'TRANSFER' as const,
      destinationLocationId: destination.locationId,
      destinationLocationName: destination.locationName,
      suggestedTransferQty,
      reason: `${surplus.itemName} is ${surplusQty} over target here; ${destination.locationName} is below min by ${need}.`,
      risk: surplusQty >= surplus.targetQty ? 'HIGH' as const : 'MEDIUM' as const,
    }];
  });
}
