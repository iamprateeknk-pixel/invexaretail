// ADR-002 / Week 4: the Catalog repository for Item. Every exported function
// requires a TenantContext as its first argument - not optional, not
// inferred from a route param - and every query it runs is scoped by
// ctx.companyId. Callers cannot "forget" to scope a query the way
// lib/item-master-service.ts's old requireItem() did (it looked an item up
// by id alone, with no ownership check at all - the exact defect this
// repository exists to make structurally impossible to repeat).
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { ownerOfItem } from '../saas/tenant-scope.js';
import { items as memoryItems, type ItemRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

export class ItemNotFoundError extends Error {
  constructor(itemId: string) {
    // Deliberately the same message/shape whether the item does not exist at
    // all or belongs to a different tenant - a wrong-tenant lookup must not
    // be distinguishable from a genuinely missing item.
    super(`Item ${itemId} was not found.`);
    this.name = 'ItemNotFoundError';
  }
}

/** Scoped lookup: returns the item only if it belongs to ctx.companyId, never leaking existence across tenants. */
export async function findItemById(ctx: TenantContext, itemId: string): Promise<ItemRecord | null> {
  if (databaseEnabled) {
    const row = await prisma.item.findFirst({ where: { id: itemId, companyId: ctx.companyId } });
    return row as unknown as ItemRecord | null;
  }
  if (ownerOfItem(itemId) !== ctx.companyId) return null;
  return memoryItems.find((item) => item.id === itemId) ?? null;
}

/** Same as findItemById but throws, for call sites that treat "not mine" the same as "does not exist". */
export async function requireItemById(ctx: TenantContext, itemId: string): Promise<ItemRecord> {
  const item = await findItemById(ctx, itemId);
  if (!item) throw new ItemNotFoundError(itemId);
  return item;
}

export async function listItems(ctx: TenantContext, filter: { status?: string } = {}): Promise<ItemRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.item.findMany({ where: { companyId: ctx.companyId, ...(filter.status ? { status: filter.status } : {}) } });
    return rows as unknown as ItemRecord[];
  }
  return memoryItems.filter((item) => ownerOfItem(item.id) === ctx.companyId && (!filter.status || item.status === filter.status));
}

/**
 * Guard for a mutation (status change, delete) that the caller implements
 * elsewhere but must not run before confirming tenant ownership. Throws
 * ItemNotFoundError - the same shape as a genuinely missing item - rather
 * than returning a boolean a caller could accidentally ignore.
 */
export async function assertItemOwnedByTenant(ctx: TenantContext, itemId: string): Promise<void> {
  if (!databaseEnabled) {
    if (ownerOfItem(itemId) !== ctx.companyId) throw new ItemNotFoundError(itemId);
    return;
  }
  const owned = await prisma.item.findFirst({ where: { id: itemId, companyId: ctx.companyId }, select: { id: true } });
  if (!owned) throw new ItemNotFoundError(itemId);
}
