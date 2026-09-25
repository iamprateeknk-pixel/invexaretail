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
};

export type ReplenishmentRoute = {
  action: 'NONE' | 'TRANSFER' | 'PURCHASE';
  sourceLocationId?: string;
  sourceLocationName?: string;
  suggestedTransferQty: number;
  reason: string;
};

export function routeReplenishment(
  destinationLocationId: string,
  requiredQty: number,
  network: NetworkStock[],
): ReplenishmentRoute {
  if (!Number.isFinite(requiredQty) || requiredQty <= 0) {
    return { action: 'NONE', suggestedTransferQty: 0, reason: 'Stock is at or above target.' };
  }
  const candidates = network
    .map((row) => ({ ...row, available: Math.max(0, row.available - Math.max(0, row.protectedQty ?? 0)) }))
    .filter((row) => row.locationId !== destinationLocationId && row.available > 0)
    .sort((a, b) => {
      const warehousePriority = Number(String(b.locationType).toLowerCase() === 'warehouse') - Number(String(a.locationType).toLowerCase() === 'warehouse');
      return warehousePriority || b.available - a.available || a.locationName.localeCompare(b.locationName);
    });
  const source = candidates[0];
  if (!source) {
    return { action: 'PURCHASE', suggestedTransferQty: 0, reason: 'No other branch has available stock; purchase into H.O. Basni.' };
  }
  const quantity = Math.min(requiredQty, source.available);
  return {
    action: 'TRANSFER',
    sourceLocationId: source.locationId,
    sourceLocationName: source.locationName,
    suggestedTransferQty: quantity,
    reason: quantity >= requiredQty
      ? 'Target can be restored from network stock.'
      : 'Use available network stock first; purchase the remaining shortage into H.O. Basni.',
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
}): RuleReplenishment {
  const position = input.availableHere + Math.max(0, input.incoming);
  const risk: RuleReplenishment['risk'] = position <= 0 ? 'CRITICAL' : position <= input.minQty ? 'HIGH' : 'HEALTHY';
  const suggestedOrderQty = position <= input.minQty ? Math.max(0, input.targetQty - position) : 0;
  const route = routeReplenishment(input.destinationLocationId, suggestedOrderQty, input.network);
  if (route.action === 'NONE' && position > input.minQty) route.reason = 'Above the reorder minimum; nothing to do.';
  return { position, suggestedOrderQty, route, risk };
}
