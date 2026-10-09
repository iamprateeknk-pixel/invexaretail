// Database-first slice 2 (docs/db-first-reads-plan.md): the imported daily-movement history, read from Postgres
// instead of the in-memory snapshot. The snapshot only ever holds the newest 10,000 movements across ALL companies
// (lib/persistence.ts hydration), so a busy company could push another company's history out of it; a per-company
// query has no such cross-company limit.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import { dailyMovements, type DailyMovementRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

export const MOVEMENT_HISTORY_LIMIT = 500;

/** The company's most recent imported movements, newest first (id breaks ties so the order is stable). */
export async function listRecentMovementsForCompany(ctx: TenantContext, limit = MOVEMENT_HISTORY_LIMIT): Promise<DailyMovementRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.inventoryMovement.findMany({
      where: { location: { companyId: ctx.companyId } },
      orderBy: [{ transactionAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      dedupeKey: row.dedupeKey,
      itemId: row.itemId,
      lotId: row.lotId ?? undefined,
      locationId: row.locationId,
      movementType: row.movementType,
      qtyDelta: row.qtyDelta,
      transactionAt: row.transactionAt.toISOString(),
      sourceType: row.sourceType as DailyMovementRecord['sourceType'],
      sourceReference: row.sourceReference,
      importBatchId: row.importBatchId ?? undefined,
      createdById: row.createdById,
      metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    }));
  }
  // A location with no known owner belongs to nobody, so its movements are left out rather than shown to everyone.
  return dailyMovements
    .filter((movement) => companyOwnsLocation(ctx.companyId, movement.locationId))
    .map((movement) => ({ ...movement }))
    .sort((a, b) => b.transactionAt.localeCompare(a.transactionAt) || b.id.localeCompare(a.id))
    .slice(0, limit);
}
