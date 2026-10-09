// Database-first slice 4 (docs/db-first-reads-plan.md): per-location "synced through" checkpoints for a company,
// read from Postgres instead of the in-memory snapshot. Scoped through the checkpoint's location.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import { syncCheckpoints, type SyncCheckpointRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

export async function listSyncCheckpointsForCompany(ctx: TenantContext): Promise<SyncCheckpointRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.syncCheckpoint.findMany({
      where: { location: { companyId: ctx.companyId } },
      orderBy: [{ locationId: 'asc' }, { sourceType: 'asc' }],
    });
    return rows
      .filter((row) => row.sourceType === 'SALES' || row.sourceType === 'PURCHASE')
      .map((row) => ({
        locationId: row.locationId,
        sourceType: row.sourceType as SyncCheckpointRecord['sourceType'],
        syncedThroughAt: row.syncedThroughAt.toISOString(),
        lastImportBatchId: row.lastImportBatchId ?? '',
      }));
  }
  return syncCheckpoints.filter((entry) => companyOwnsLocation(ctx.companyId, entry.locationId)).map((entry) => ({ ...entry }));
}
