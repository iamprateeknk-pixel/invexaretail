// Database-first slice 1 (docs/db-first-reads-plan.md): the Location read side, scoped by TenantContext like
// item-repository.ts. In database mode it reads Postgres directly instead of the in-memory snapshot; in memory mode
// it reads the snapshot, filtered by the same ownership map the rest of the request path already trusts.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import { locations as memoryLocations, type LocationRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';



/**
 * Every location the company owns, in a stable order (oldest first, id as the tie-break) so "the first location"
 * (the default active one) does not depend on the order rows happen to sit in memory.
 */
export async function listLocationsForCompany(ctx: TenantContext): Promise<LocationRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.location.findMany({
      where: { companyId: ctx.companyId },
      select: { id: true, name: true, type: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ id: row.id, name: row.name, type: row.type as LocationRecord['type'] }));
  }
  return memoryLocations.filter((location) => companyOwnsLocation(ctx.companyId, location.id)).map((location) => ({ ...location }));
}
