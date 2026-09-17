// Blueprint Module G / section 13.3 (OMS & Allocation) - order routing:
// "Routing rules: nearest eligible location, stock age/expiry, shipping
// SLA, workload and cost." Candidates now carry optional geo, SLA, per-km
// shipping cost and open-order workload. When those signals are present
// they are scored together; when they are missing the original
// store-before-warehouse heuristic is still the tie-break so routing never
// fabricates a distance or cost.

export type LocationCandidate = {
  locationId: string;
  locationName: string;
  locationType: string;
  latitude?: number | null;
  longitude?: number | null;
  deliverySlaHours?: number | null;
  shippingCostPerKm?: number | null;
  openOrderCount?: number | null;
};

export type RoutingContext = {
  customerLatitude?: number | null;
  customerLongitude?: number | null;
};

export const ROUTING_WEIGHTS = {
  distance: 0.4,
  sla: 0.2,
  cost: 0.2,
  workload: 0.15,
  storePreference: 0.05,
} as const;

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isStoreLocation(type: string): boolean {
  return String(type).toLowerCase() === 'store';
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function candidateRoutingScore(candidate: LocationCandidate, ctx: RoutingContext = {}): number {
  const customerLat = finiteOrNull(ctx.customerLatitude);
  const customerLng = finiteOrNull(ctx.customerLongitude);
  const lat = finiteOrNull(candidate.latitude);
  const lng = finiteOrNull(candidate.longitude);
  const sla = finiteOrNull(candidate.deliverySlaHours);
  const costPerKm = finiteOrNull(candidate.shippingCostPerKm);
  const workload = finiteOrNull(candidate.openOrderCount);

  let distanceKm: number | null = null;
  if (customerLat !== null && customerLng !== null && lat !== null && lng !== null) {
    distanceKm = haversineKm(customerLat, customerLng, lat, lng);
  }

  // Lower is better. Missing signals contribute 0 so they never invent a
  // penalty, and the remaining weights still discriminate.
  const distanceScore = distanceKm === null ? 0 : distanceKm;
  const slaScore = sla === null ? 0 : sla;
  const costScore =
    costPerKm === null || distanceKm === null ? (costPerKm ?? 0) : costPerKm * distanceKm;
  const workloadScore = workload === null ? 0 : workload;
  const storeScore = isStoreLocation(candidate.locationType) ? 0 : 1;

  return (
    ROUTING_WEIGHTS.distance * distanceScore +
    ROUTING_WEIGHTS.sla * slaScore +
    ROUTING_WEIGHTS.cost * costScore +
    ROUTING_WEIGHTS.workload * workloadScore +
    ROUTING_WEIGHTS.storePreference * storeScore
  );
}

export function rankOrderCandidates(
  candidates: LocationCandidate[],
  ctx: RoutingContext = {},
): LocationCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreDelta = candidateRoutingScore(a, ctx) - candidateRoutingScore(b, ctx);
    if (Math.abs(scoreDelta) > 1e-9) return scoreDelta;
    const storeFirst =
      Number(!isStoreLocation(a.locationType)) - Number(!isStoreLocation(b.locationType));
    return storeFirst || a.locationName.localeCompare(b.locationName);
  });
}

export type SplitLine = { itemId: string; quantity: number };
export type LocationAvailability = Map<string, Map<string, number>>;
export type SplitSlice = { locationId: string; lines: SplitLine[] };

/**
 * Greedy multi-location split: walk ranked candidates and take whatever
 * each location can still promise, per item, until every line is covered
 * or leftover remainder is reported as backorder. Pure so OMS can decide
 * "split vs fail" without touching the database.
 */
export function splitLinesAcrossLocations(
  lines: SplitLine[],
  ranked: LocationCandidate[],
  availability: LocationAvailability,
): { splits: SplitSlice[]; remainder: SplitLine[] } {
  const remaining = new Map<string, number>();
  for (const line of lines) {
    remaining.set(line.itemId, (remaining.get(line.itemId) ?? 0) + line.quantity);
  }

  const splits: SplitSlice[] = [];
  for (const candidate of ranked) {
    const atLocation = availability.get(candidate.locationId);
    if (!atLocation) continue;
    const slice: SplitLine[] = [];
    for (const [itemId, needed] of remaining) {
      if (needed <= 1e-8) continue;
      const available = Math.max(0, atLocation.get(itemId) ?? 0);
      const take = Math.min(needed, available);
      if (take <= 1e-8) continue;
      slice.push({ itemId, quantity: take });
      remaining.set(itemId, needed - take);
      atLocation.set(itemId, available - take);
    }
    if (slice.length) splits.push({ locationId: candidate.locationId, lines: slice });
  }

  const remainder: SplitLine[] = [...remaining.entries()]
    .filter(([, quantity]) => quantity > 1e-8)
    .map(([itemId, quantity]) => ({ itemId, quantity }));
  return { splits, remainder };
}
