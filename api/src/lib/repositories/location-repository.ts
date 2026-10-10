// Database-first slice 1 (docs/db-first-reads-plan.md): the Location read side, scoped by TenantContext like
// item-repository.ts. In database mode it reads Postgres directly instead of the in-memory snapshot; in memory mode
// it reads the snapshot, filtered by the same ownership map the rest of the request path already trusts.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import { locations as memoryLocations, type LocationRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

export class LocationOrderError extends Error {}

/**
 * Every location the company owns, in the admin-chosen order (sortOrder), then oldest first with id as the
 * tie-break - so "the first location" (the default active one) never depends on the order rows sit in memory.
 */
export async function listLocationsForCompany(ctx: TenantContext): Promise<LocationRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.location.findMany({
      where: { companyId: ctx.companyId },
      select: { id: true, name: true, type: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ id: row.id, name: row.name, type: row.type as LocationRecord['type'], sortOrder: row.sortOrder }));
  }
  // Array.prototype.sort is stable, so equal sortOrder keeps the snapshot's (creation) order.
  return memoryLocations
    .filter((location) => companyOwnsLocation(ctx.companyId, location.id))
    .map((location) => ({ ...location }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/**
 * Saves a new display order. `orderedIds` must be exactly the company's own locations, each once - another
 * company's id fails the same way an unknown one does, so the call never reveals that it exists.
 */
export async function saveLocationOrder(ctx: TenantContext, orderedIds: unknown): Promise<LocationRecord[]> {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
    throw new LocationOrderError('locationIds must be an array of location ids.');
  }
  const owned = await listLocationsForCompany(ctx);
  const ownedIds = new Set(owned.map((location) => location.id));
  const ids = orderedIds as string[];
  if (new Set(ids).size !== ids.length || ids.length !== ownedIds.size || ids.some((id) => !ownedIds.has(id))) {
    throw new LocationOrderError('Send every location of this company exactly once, in the new order.');
  }
  if (databaseEnabled) {
    await prisma.$transaction(ids.map((id, index) => prisma.location.updateMany({
      where: { id, companyId: ctx.companyId },
      data: { sortOrder: index + 1 },
    })));
  }
  // Keep the in-memory snapshot in step (it is the read source in memory mode and a mirror in database mode).
  ids.forEach((id, index) => {
    const record = memoryLocations.find((location) => location.id === id);
    if (record) record.sortOrder = index + 1;
  });
  return listLocationsForCompany(ctx);
}
