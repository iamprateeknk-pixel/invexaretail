export type NetworkStock = {
  locationId: string;
  locationName: string;
  locationType: string;
  available: number;
  /**
   * Stock the donor must keep for itself (its own reorder minimum). A branch is
   * never asked to give away stock below its own minimum - otherwise a
   * replenishment for one store simply creates the next stockout at another.
   */
  protectedQty?: number;
  /** Geo/cost fields for donor ranking (audit R-1: "no cost/lead-time comparison between donors"). */
  latitude?: number | null;
  longitude?: number | null;
  shippingCostPerKm?: number | null;
  /** A location's own quoted delivery SLA, used as a lead-time tie-break when distance alone does not decide it. */
  deliverySlaHours?: number | null;
};

/** Coordinates and cost data for the location being replenished, so donors can be ranked against it. */
export type DestinationGeo = {
  latitude?: number | null;
  longitude?: number | null;
  shippingCostPerKm?: number | null;
};

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line distance x an estimated per-km rate (the average of whichever ends quote one),
 * rounded to whole currency units. Null when either end's coordinates are missing - a real
 * comparison is only made with real data, never guessed from location type alone.
 */
export function estimatedTransferCost(donor: NetworkStock, destination: DestinationGeo): number | null {
  if (donor.latitude == null || donor.longitude == null || destination.latitude == null || destination.longitude == null) return null;
  const rates = [donor.shippingCostPerKm, destination.shippingCostPerKm].filter((rate): rate is number => rate != null && rate > 0);
  if (!rates.length) return null;
  const rate = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  const km = haversineKm({ latitude: donor.latitude, longitude: donor.longitude }, { latitude: destination.latitude, longitude: destination.longitude });
  return Math.round(km * rate);
}

export type ReplenishmentRoute = {
  action: 'NONE' | 'TRANSFER' | 'PURCHASE';
  sourceLocationId?: string;
  sourceLocationName?: string;
  suggestedTransferQty: number;
  /** Every donor used, in order (audit R-1: one donor used to cap the transfer even when several could cover it). */
  sources?: Array<{ locationId: string; locationName: string; quantity: number; estimatedCost?: number | null }>;
  /** Part of the need no donor can cover; the caller buys it. */
  shortfallQty?: number;
  reason: string;
};

export function routeReplenishment(
  destinationLocationId: string,
  requiredQty: number,
  network: NetworkStock[],
  /** Where a purchase lands. Defaults to the company's own first warehouse (it was hard-coded to one customer's site). */
  purchaseHub?: string,
  /** The destination's own coordinates/rate, so donors can be ranked by estimated shipping cost (audit R-1). */
  destination?: DestinationGeo,
): ReplenishmentRoute {
  const hub = purchaseHub ?? [...network].filter((row) => String(row.locationType).toLowerCase() === 'warehouse').sort((a, b) => a.locationName.localeCompare(b.locationName))[0]?.locationName ?? 'the main warehouse';
  if (!Number.isFinite(requiredQty) || requiredQty <= 0) {
    return { action: 'NONE', suggestedTransferQty: 0, reason: 'Stock is at or above target.' };
  }
  const candidates = network
    .map((row) => ({ ...row, available: Math.max(0, row.available - Math.max(0, row.protectedQty ?? 0)), estimatedCost: destination ? estimatedTransferCost(row, destination) : null }))
    .filter((row) => row.locationId !== destinationLocationId && row.available > 0)
    .sort((a, b) => {
      // Real cost data beats a heuristic guess: a donor whose estimated shipping cost is known
      // ranks by that (cheapest first) ahead of any donor with no coordinates to compare against.
      // Without cost data for BOTH sides, the previous type/quantity heuristic still decides
      // (audit R-1: "no cost/lead-time comparison between donors - still nearest/largest-first").
      if (a.estimatedCost !== null && b.estimatedCost !== null) return a.estimatedCost - b.estimatedCost || a.locationName.localeCompare(b.locationName);
      if (a.estimatedCost !== null) return -1;
      if (b.estimatedCost !== null) return 1;
      // Neither side has cost data: an SLA figure (when at least one side quotes one) breaks the tie
      // before falling back to the original type/quantity heuristic.
      if (a.deliverySlaHours != null || b.deliverySlaHours != null) {
        const slaCompare = (a.deliverySlaHours ?? Infinity) - (b.deliverySlaHours ?? Infinity);
        if (slaCompare !== 0) return slaCompare;
      }
      const warehousePriority = Number(String(b.locationType).toLowerCase() === 'warehouse') - Number(String(a.locationType).toLowerCase() === 'warehouse');
      return warehousePriority || b.available - a.available || a.locationName.localeCompare(b.locationName);
    });
  if (!candidates.length) {
    return { action: 'PURCHASE', suggestedTransferQty: 0, shortfallQty: requiredQty, reason: 'No other branch has available stock; purchase into ' + hub + '.' };
  }
  // Take from donors in priority order until the need is covered, so two donors together can fill it.
  const sources: Array<{ locationId: string; locationName: string; quantity: number; estimatedCost?: number | null }> = [];
  let remaining = requiredQty;
  for (const donor of candidates) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, donor.available);
    sources.push({ locationId: donor.locationId, locationName: donor.locationName, quantity, estimatedCost: donor.estimatedCost });
    remaining -= quantity;
  }
  const quantity = requiredQty - Math.max(0, remaining);
  const costNote = sources[0].estimatedCost != null ? ` (est. shipping cost ${sources[0].estimatedCost})` : '';
  return {
    action: 'TRANSFER',
    sourceLocationId: sources[0].locationId,
    sourceLocationName: sources[0].locationName,
    suggestedTransferQty: quantity,
    sources,
    shortfallQty: Math.max(0, remaining),
    reason: remaining <= 0
      ? `Target can be restored from network stock${costNote}.`
      : `Use available network stock first${costNote}; purchase the remaining shortage into ${hub}.`,
  };
}

export type RuleReplenishment = {
  position: number;
  suggestedOrderQty: number;
  route: ReplenishmentRoute;
  risk: 'CRITICAL' | 'HIGH' | 'HEALTHY';
};

/**
 * One min/max (s, S) decision for an item at a location, shared by every
 * intelligence path. The rule is: act only when the inventory position - what is
 * available here (on hand minus reserved) plus what is already on its way (in-transit
 * transfers) - has fallen to the minimum; then order up to the target. The old code
 * ordered up to target whenever position was below TARGET, so a perfectly healthy
 * item sitting between min and target generated a transfer/purchase every time the
 * screen was opened (audit P1-1), and it ignored transfers already in flight.
 */
export function planRuleReplenishment(input: {
  destinationLocationId: string;
  availableHere: number;
  incoming: number;
  minQty: number;
  targetQty: number;
  network: NetworkStock[];
  purchaseHub?: string;
  destination?: DestinationGeo;
}): RuleReplenishment {
  const position = input.availableHere + Math.max(0, input.incoming);
  const risk: RuleReplenishment['risk'] = position <= 0 ? 'CRITICAL' : position <= input.minQty ? 'HIGH' : 'HEALTHY';
  const suggestedOrderQty = position <= input.minQty ? Math.max(0, input.targetQty - position) : 0;
  const route = routeReplenishment(input.destinationLocationId, suggestedOrderQty, input.network, input.purchaseHub, input.destination);
  if (route.action === 'NONE' && position > input.minQty) route.reason = 'Above the reorder minimum; nothing to do.';
  return { position, suggestedOrderQty, route, risk };
}
