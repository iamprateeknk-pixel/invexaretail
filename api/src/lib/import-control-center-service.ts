import { prisma } from './db.js';
import { getBatch, listRows } from './import-batch-store.js';
import { databaseEnabled } from './persistence.js';
import { dailyMovements } from './repository.js';
import type { ControlCenterLocation, ImportSourceType, MovementActivity } from './import-control-center.js';

const SOURCES: ImportSourceType[] = ['SALES', 'PURCHASE'];

/** Movements whose transaction time falls in [from, to), grouped per branch and source. */
export async function loadMovementActivity(from: string, to: string): Promise<MovementActivity[]> {
  if (!databaseEnabled) {
    const grouped = new Map<string, MovementActivity>();
    for (const movement of dailyMovements) {
      if (!SOURCES.includes(movement.sourceType as ImportSourceType)) continue;
      if (movement.transactionAt < from || movement.transactionAt >= to) continue;
      const key = `${movement.locationId}|${movement.sourceType}`;
      const current = grouped.get(key) ?? { locationId: movement.locationId, sourceType: movement.sourceType as ImportSourceType, count: 0, lastTransactionAt: movement.transactionAt, batchIds: [] };
      current.count += 1;
      if (movement.transactionAt > current.lastTransactionAt) current.lastTransactionAt = movement.transactionAt;
      if (movement.importBatchId && !current.batchIds.includes(movement.importBatchId)) current.batchIds.push(movement.importBatchId);
      grouped.set(key, current);
    }
    return [...grouped.values()];
  }
  const where = { transactionAt: { gte: new Date(from), lt: new Date(to) }, sourceType: { in: SOURCES } };
  const [groups, batches] = await Promise.all([
    prisma.inventoryMovement.groupBy({ by: ['locationId', 'sourceType'], where, _count: { _all: true }, _max: { transactionAt: true } }),
    prisma.inventoryMovement.findMany({ where, distinct: ['locationId', 'sourceType', 'importBatchId'], select: { locationId: true, sourceType: true, importBatchId: true } }),
  ]);
  return groups.map((group) => ({
    locationId: group.locationId,
    sourceType: group.sourceType as ImportSourceType,
    count: group._count._all,
    lastTransactionAt: (group._max.transactionAt ?? new Date(from)).toISOString(),
    batchIds: batches
      .filter((row) => row.locationId === group.locationId && row.sourceType === group.sourceType && row.importBatchId)
      .map((row) => row.importBatchId as string),
  }));
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

/**
 * Rows the day's files rejected, attributed to a branch where the staged row
 * still names one (a row rejected for an unknown branch cannot be attributed).
 */
export async function loadRejectedRows(
  batchIds: string[],
  locations: ControlCenterLocation[],
): Promise<{ byLocation: Map<string, { sales: number; purchases: number }>; unattributed: { sales: number; purchases: number } }> {
  const byLocation = new Map<string, { sales: number; purchases: number }>();
  const unattributed = { sales: 0, purchases: 0 };
  for (const batchId of [...new Set(batchIds)]) {
    const batch = await getBatch(batchId);
    if (!batch || (batch.type !== 'SALES' && batch.type !== 'PURCHASE')) continue;
    const key = batch.type === 'SALES' ? 'sales' : 'purchases';
    for (const row of await listRows(batchId, 'INVALID')) {
      const location = locations.find((candidate) => normalize(candidate.name) === normalize(row.rawData?.locationName));
      if (!location) {
        unattributed[key] += 1;
        continue;
      }
      const current = byLocation.get(location.id) ?? { sales: 0, purchases: 0 };
      current[key] += 1;
      byLocation.set(location.id, current);
    }
  }
  return { byLocation, unattributed };
}
