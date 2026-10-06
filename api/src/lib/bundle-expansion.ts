// Selling a virtual bundle (kit) consumes its components, not stock of its own.
// An order line for a bundle item is replaced by component lines
// (quantity x component quantity) before stock is allocated and reserved, so
// the existing reservation, fulfilment and posting paths work unchanged and
// every component movement is posted through the canonical service.
import { prisma } from './db.js';
import type { OrderLineInput } from './orders.js';

export type BundleDefinitions = Map<string, Array<{ itemId: string; quantity: number }>>;

/**
 * Pure expansion. Non-bundle lines pass through unchanged. Lines that end up
 * on the same item (two bundles sharing a component, or a component also sold
 * on its own) are merged: quantities add, and the stricter shelf-life
 * requirement wins. Input order is preserved by first appearance.
 */
export function expandBundleLines(lines: OrderLineInput[], bundles: BundleDefinitions): OrderLineInput[] {
  const merged = new Map<string, OrderLineInput>();
  const add = (itemId: string, quantity: number, minRslPercent?: number) => {
    const existing = merged.get(itemId);
    if (!existing) {
      merged.set(itemId, { itemId, quantity, ...(minRslPercent !== undefined ? { minRslPercent } : {}) });
      return;
    }
    existing.quantity += quantity;
    if (minRslPercent !== undefined) existing.minRslPercent = Math.max(existing.minRslPercent ?? 0, minRslPercent);
  };
  for (const line of lines) {
    const components = bundles.get(line.itemId);
    if (!components) {
      add(line.itemId, line.quantity, line.minRslPercent);
      continue;
    }
    for (const component of components) add(component.itemId, line.quantity * component.quantity, line.minRslPercent);
  }
  return [...merged.values()];
}

export async function loadBundleDefinitions(companyId: string, itemIds: string[]): Promise<BundleDefinitions> {
  const rows = await prisma.itemBundleComponent.findMany({
    where: { companyId, bundleItemId: { in: itemIds } },
    select: { bundleItemId: true, componentItemId: true, quantity: true },
  });
  const definitions: BundleDefinitions = new Map();
  for (const row of rows) {
    const list = definitions.get(row.bundleItemId) ?? [];
    list.push({ itemId: row.componentItemId, quantity: Number(row.quantity) });
    definitions.set(row.bundleItemId, list);
  }
  return definitions;
}

/** Loads definitions for the lines' items and expands. A no-op (one query) when nothing is a bundle. */
export async function expandOrderLinesForBundles(companyId: string, lines: OrderLineInput[]): Promise<OrderLineInput[]> {
  const definitions = await loadBundleDefinitions(companyId, [...new Set(lines.map((line) => line.itemId))]);
  return definitions.size ? expandBundleLines(lines, definitions) : lines;
}
