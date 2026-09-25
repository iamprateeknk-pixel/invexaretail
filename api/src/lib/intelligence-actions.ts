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

/**
 * Overstock -> needy-store transfers, allocated across the WHOLE network for each item (audit R-1).
 * Each surplus location's screen used to recommend filling the same needy store on its own, so three
 * surplus branches would all "fill" one gap three times over. Now the need is handed out once, in a
 * fixed order (largest surplus first, ties by location id), and each screen shows only its own share.
 * `incoming` (units already on their way, keyed `itemId|locationId`) reduces a store's need first.
 */
export function buildOverstockRecommendations(
  rows: OverstockInput[],
  currentLocationId: string,
  incoming: Map<string, number> = new Map(),
): OverstockRecommendation[] {
  const items = [...new Set(rows.map((row) => row.itemId))];
  const result: OverstockRecommendation[] = [];
  for (const itemId of items) {
    const itemRows = rows.filter((row) => row.itemId === itemId);
    const donors = itemRows
      .filter((row) => row.onHand > row.targetQty && row.targetQty > 0)
      .map((row) => ({ row, left: row.onHand - row.targetQty }))
      .sort((a, b) => b.left - a.left || a.row.locationId.localeCompare(b.row.locationId));
    const needy = itemRows
      .filter((row) => row.onHand < row.minQty && !donors.some((donor) => donor.row.locationId === row.locationId))
      .map((row) => ({ row, need: row.minQty - row.onHand - Math.max(0, incoming.get(`${itemId}|${row.locationId}`) ?? 0) }))
      .filter((entry) => entry.need > 0)
      .sort((a, b) => b.need - a.need || a.row.locationId.localeCompare(b.row.locationId));
    for (const donor of donors) {
      for (const target of needy) {
        if (donor.left <= 0) break;
        if (target.need <= 0) continue;
        const quantity = Math.min(donor.left, target.need);
        donor.left -= quantity;
        target.need -= quantity;
        if (donor.row.locationId !== currentLocationId) continue;
        const surplusQty = donor.row.onHand - donor.row.targetQty;
        result.push({
          type: 'OVERSTOCK' as const,
          itemId,
          itemName: donor.row.itemName,
          locationId: donor.row.locationId,
          onHand: donor.row.onHand,
          targetQty: donor.row.targetQty,
          surplusQty,
          suggestedAction: 'TRANSFER' as const,
          destinationLocationId: target.row.locationId,
          destinationLocationName: target.row.locationName,
          suggestedTransferQty: quantity,
          reason: `${donor.row.itemName} is ${surplusQty} over target here; ${target.row.locationName} is below min by ${target.row.minQty - target.row.onHand}.`,
          risk: surplusQty >= donor.row.targetQty ? 'HIGH' as const : 'MEDIUM' as const,
        });
      }
    }
  }
  return result;
}
