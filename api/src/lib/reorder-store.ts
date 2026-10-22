import { planRuleReplenishment } from './replenishment.js';
import { sellableQuantity } from './sellable-stock.js';
import {
  listCounts,
  listItems,
  listLocations,
  listTransfers,
  type StockLedgerRecord,
} from './repository.js';
import { seedReorderRules } from './seed.js';
import { replaceContents } from './array-utils.js';

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

/**
 * Reorder quantities: whole numbers for counted items, up to 3 decimals for loose/KG items
 * (audit O-4: rules were integer-only, so a KG item could not have a 2.5 kg minimum).
 */
export function validateReorderQuantities(minQty: number, targetQty: number, decimal: boolean): string | null {
  if (!Number.isFinite(minQty) || !Number.isFinite(targetQty) || minQty < 0) return 'A non-negative minimum and a target not below it are required.';
  if (targetQty < minQty) return 'The target must not be below the minimum.';
  const fits = (value: number) => (decimal ? Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6 : Number.isInteger(value));
  if (!fits(minQty) || !fits(targetQty)) return decimal ? 'Quantities support up to 3 decimal places.' : 'Quantities must be whole numbers for this item.';
  return null;
}

export function resetReorderStore(): void {
  replaceContents(rules, seedReorderRules.map((rule) => ({
    ...rule,
    createdAt: new Date(0).toISOString(),
  })));
}

export function listReorderRules(locationId: string): ReorderRuleRecord[] {
  return rules.filter((rule) => rule.locationId === locationId).map((rule) => ({ ...rule }));
}

export function upsertReorderRule(input: { itemId: string; locationId: string; minQty: number; targetQty: number; decimal?: boolean }): ReorderRuleRecord {
  const minQty = Number(input.minQty);
  const targetQty = Number(input.targetQty);
  const invalid = !input.itemId || !input.locationId ? 'Location, non-negative minimum and target not below minimum are required.' : validateReorderQuantities(minQty, targetQty, Boolean(input.decimal));
  if (invalid) throw new Error(invalid);
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

export function buildReplenishmentIntelligence(locationId: string, ledger: StockLedgerRecord[]) {
  const locationRules = listReorderRules(locationId);
  const items = listItems();
  const locations = listLocations();
  const counts = listCounts().filter((count) => count.locationId === locationId);
  const quantities = new Map<string, { onHand: number; reserved: number; inTransit: number }>();
  const network = new Map<string, Map<string, { locationId: string; locationName: string; locationType: string; available: number }>>();

  // Phase 5 step 5: the stock input arrives from the caller, loaded through
  // the tenant-scoped stock repository — this builder no longer reads the
  // snapshot ledger itself. The accumulation mirrors the database branch of
  // GET /intelligence/:locationId exactly (sellable lots only; reserved
  // counted against rows that are sellable): before this, the builder used
  // raw on-hand and never read reserved at all, so the two implementations
  // of the same endpoint disagreed on availability by exactly the reserved
  // bucket (see the step 5 characterization pin).
  for (const entry of ledger) {
    const item = items.find((row) => row.id === entry.itemId);
    const lot = item?.lots.find((row) => row.id === entry.lotId);
    const lotInput = lot ? { status: lot.status, expiryDate: lot.expiryDate } : null;
    const sellableHere = sellableQuantity({ onHand: entry.onHand, reserved: 0, lot: lotInput });
    if (entry.locationId === locationId) {
      const current = quantities.get(entry.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
      current.onHand += sellableHere;
      current.reserved += sellableHere > 0 ? (entry.reserved ?? 0) : 0;
      current.inTransit += entry.inTransit ?? 0;
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
    source.available += sellableQuantity({ onHand: entry.onHand, reserved: entry.reserved ?? 0, lot: lotInput });
    byLocation.set(entry.locationId, source);
    network.set(entry.itemId, byLocation);
  }

  // Stock already on its way here (dispatched, not yet received) counts toward the position.
  const incoming = new Map<string, number>();
  for (const transfer of listTransfers()) {
    if (transfer.destinationLocationId !== locationId || !['DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'PARTIAL_RECEIVED'].includes(String(transfer.status))) continue;
    for (const line of transfer.lines) {
      const outstanding = Math.max(0, line.quantity - Number((line as { receivedQty?: number }).receivedQty ?? 0));
      incoming.set(line.itemId, (incoming.get(line.itemId) ?? 0) + outstanding);
    }
  }
  // Every location's own minimum for the item, so a donor is never drained below it.
  const minimumAt = (itemId: string, donorLocationId: string) => rules.find((row) => row.itemId === itemId && row.locationId === donorLocationId)?.minQty ?? 0;

  const recommendations = locationRules.map((rule) => {
    const item = items.find((entry) => entry.id === rule.itemId);
    const stock = quantities.get(rule.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
    const available = stock.onHand - stock.reserved;
    const network_ = [...(network.get(rule.itemId)?.values() ?? [])].map((row) => ({ ...row, protectedQty: minimumAt(rule.itemId, row.locationId) }));
    const plan = planRuleReplenishment({
      destinationLocationId: locationId, availableHere: available, incoming: incoming.get(rule.itemId) ?? 0,
      minQty: rule.minQty, targetQty: rule.targetQty, network: network_,
    });
    const suggestedOrderQty = plan.suggestedOrderQty;
    const route = plan.route;
    const history = counts.filter((count) => count.itemId === rule.itemId);
    const meanVariance = history.length
      ? history.reduce((sum, count) => sum + Math.abs(count.physicalQuantity - count.bookQty), 0) / history.length
      : 0;
    return {
      itemId: rule.itemId,
      itemName: item?.name ?? rule.itemId,
      available: plan.position,
      minQty: rule.minQty,
      targetQty: rule.targetQty,
      suggestedOrderQty,
      suggestedAction: route.action,
      sourceLocationId: route.sourceLocationId,
      sourceLocationName: route.sourceLocationName,
      suggestedTransferQty: route.suggestedTransferQty,
      actionReason: route.reason,
      risk: plan.risk,
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
      // Same fix as the database-mode summary in operations-extension.ts: the purchase hub is
      // per-company and chosen dynamically - this line used to hard-code one customer's site
      // ("H.O. Basni") regardless of the actual configured warehouse (audit R-1 leftover).
      ? `${transfers} network transfer${transfers === 1 ? '' : 's'} and ${purchases} warehouse purchase action${purchases === 1 ? '' : 's'} recommended.`
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
