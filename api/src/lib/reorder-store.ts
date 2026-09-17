import { routeReplenishment } from './replenishment.js';
import {
  listCounts,
  listItems,
  listLocations,
  listStockLedger,
} from './repository.js';
import { seedReorderRules } from './seed.js';

export type ReorderRuleRecord = {
  id: string;
  itemId: string;
  locationId: string;
  minQty: number;
  targetQty: number;
  createdAt: string;
};

const rules: ReorderRuleRecord[] = seedReorderRules.map((rule) => ({
  ...rule,
  createdAt: new Date(0).toISOString(),
}));

export function resetReorderStore(): void {
  rules.splice(0, rules.length, ...seedReorderRules.map((rule) => ({
    ...rule,
    createdAt: new Date(0).toISOString(),
  })));
}

export function listReorderRules(locationId: string): ReorderRuleRecord[] {
  return rules.filter((rule) => rule.locationId === locationId).map((rule) => ({ ...rule }));
}

export function upsertReorderRule(input: { itemId: string; locationId: string; minQty: number; targetQty: number }): ReorderRuleRecord {
  const minQty = Number(input.minQty);
  const targetQty = Number(input.targetQty);
  if (!input.itemId || !input.locationId || !Number.isInteger(minQty) || minQty < 0 || !Number.isInteger(targetQty) || targetQty < minQty) {
    throw new Error('Location, non-negative minimum and target not below minimum are required.');
  }
  const existing = rules.find((rule) => rule.itemId === input.itemId && rule.locationId === input.locationId);
  if (existing) {
    existing.minQty = minQty;
    existing.targetQty = targetQty;
    return { ...existing };
  }
  const created: ReorderRuleRecord = {
    id: `reorder-${input.itemId}-${input.locationId}`,
    itemId: input.itemId,
    locationId: input.locationId,
    minQty,
    targetQty,
    createdAt: new Date().toISOString(),
  };
  rules.push(created);
  return { ...created };
}

export function buildReplenishmentIntelligence(locationId: string) {
  const locationRules = listReorderRules(locationId);
  const items = listItems();
  const locations = listLocations();
  const ledger = listStockLedger();
  const counts = listCounts().filter((count) => count.locationId === locationId);
  const quantities = new Map<string, { onHand: number; reserved: number; inTransit: number }>();
  const network = new Map<string, Map<string, { locationId: string; locationName: string; locationType: string; available: number }>>();

  for (const entry of ledger) {
    if (entry.locationId === locationId) {
      const current = quantities.get(entry.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
      current.onHand += entry.onHand;
      quantities.set(entry.itemId, current);
    }
    const location = locations.find((row) => row.id === entry.locationId);
    const byLocation = network.get(entry.itemId) ?? new Map();
    const source = byLocation.get(entry.locationId) ?? {
      locationId: entry.locationId,
      locationName: location?.name ?? entry.locationId,
      locationType: location?.type ?? 'store',
      available: 0,
    };
    source.available += entry.onHand;
    byLocation.set(entry.locationId, source);
    network.set(entry.itemId, byLocation);
  }

  const recommendations = locationRules.map((rule) => {
    const item = items.find((entry) => entry.id === rule.itemId);
    const stock = quantities.get(rule.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
    const available = stock.onHand - stock.reserved + stock.inTransit;
    const suggestedOrderQty = Math.max(0, rule.targetQty - available);
    const route = routeReplenishment(locationId, suggestedOrderQty, [...(network.get(rule.itemId)?.values() ?? [])]);
    const history = counts.filter((count) => count.itemId === rule.itemId);
    const meanVariance = history.length
      ? history.reduce((sum, count) => sum + Math.abs(count.physicalQuantity - count.bookQty), 0) / history.length
      : 0;
    return {
      itemId: rule.itemId,
      itemName: item?.name ?? rule.itemId,
      available,
      minQty: rule.minQty,
      targetQty: rule.targetQty,
      suggestedOrderQty,
      suggestedAction: route.action,
      sourceLocationId: route.sourceLocationId,
      sourceLocationName: route.sourceLocationName,
      suggestedTransferQty: route.suggestedTransferQty,
      actionReason: route.reason,
      risk: available <= 0 ? 'CRITICAL' : available <= rule.minQty ? 'HIGH' : 'HEALTHY',
      confidence: history.length >= 3 && meanVariance <= Math.max(1, rule.minQty * 0.1) ? 'HIGH' : history.length ? 'MEDIUM' : 'LOW',
    };
  }).sort((a, b) => b.suggestedOrderQty - a.suggestedOrderQty);

  const anomalies = counts
    .map((count) => {
      const item = items.find((entry) => entry.id === count.itemId);
      const variance = count.physicalQuantity - count.bookQty;
      return {
        itemId: count.itemId,
        itemName: item?.name ?? count.itemId,
        countId: count.id,
        bookQty: count.bookQty,
        physicalQty: count.physicalQuantity,
        variance,
        countDate: count.createdAt,
      };
    })
    .filter((count) => Math.abs(count.variance) >= Math.max(3, Math.abs(count.bookQty) * 0.1))
    .slice(0, 20);

  const critical = recommendations.filter((entry) => entry.risk === 'CRITICAL').length;
  const transfers = recommendations.filter((entry) => entry.suggestedAction === 'TRANSFER').length;
  const purchases = recommendations.filter((entry) => entry.suggestedAction === 'PURCHASE').length;
  const executiveSummary = critical
    ? `${critical} critical item${critical === 1 ? '' : 's'}; ${transfers} network transfer${transfers === 1 ? '' : 's'} and ${purchases} purchase action${purchases === 1 ? '' : 's'} recommended.`
    : transfers || purchases
      ? `${transfers} network transfer${transfers === 1 ? '' : 's'} and ${purchases} H.O. Basni purchase action${purchases === 1 ? '' : 's'} recommended.`
      : 'Configured inventory is above reorder targets. Continue monitoring count variance.';

  return {
    generatedAt: new Date().toISOString(),
    executiveSummary,
    recommendations,
    anomalies,
    lotBlocks: [],
    expiryActions: [],
    overstock: [],
  };
}
