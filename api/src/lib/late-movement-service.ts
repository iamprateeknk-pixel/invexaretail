import { recordAudit } from './audit.js';
import { publishEvent } from './event-bus.js';
import { planLateMovementReconciliation, reconciliationNote, type LateMovement } from './late-movements.js';
import { persistAudit, persistCountReconciliation } from './persistence.js';
import { counts, type DailyMovementRecord } from './repository.js';
import { DEFAULT_COMPANY_ID, ownerOfLocation } from './saas/tenant-scope.js';

/**
 * Called after a sales/purchase import posts movements. Any count taken after
 * a movement's transaction time is affected: a pending count gets its book
 * quantity recomputed, an already-approved one is flagged for investigation.
 * Idempotent per movement (the dedupe key is remembered on the count).
 */
export async function applyLateMovements(movements: DailyMovementRecord[], actorId = 'system'): Promise<number> {
  const relevant: LateMovement[] = movements
    .filter((movement) => (movement.sourceType === 'SALES' || movement.sourceType === 'PURCHASE') && movement.lotId)
    .map((movement) => ({
      key: movement.dedupeKey,
      itemId: movement.itemId,
      lotId: movement.lotId,
      locationId: movement.locationId,
      transactionAt: movement.transactionAt,
      qtyDelta: movement.qtyDelta,
    }));
  if (!relevant.length) return 0;

  const outcomes = planLateMovementReconciliation(counts, relevant);
  const now = new Date().toISOString();
  const touchedLocations = new Set<string>();
  for (const outcome of outcomes) {
    const count = counts.find((candidate) => candidate.id === outcome.countId);
    if (!count) continue;
    const before = count.bookQty;
    if (outcome.action === 'ADJUST_PENDING') {
      count.bookQtyOriginal ??= count.bookQty;
      count.bookQty = before + outcome.lateDelta;
    }
    count.lateDelta = (count.lateDelta ?? 0) + outcome.lateDelta;
    count.lateMovementKeys = [...(count.lateMovementKeys ?? []), ...outcome.keys];
    count.reconciliationRequired = true;
    count.reconciliationAt = now;
    const sources = [...new Set(movements.filter((movement) => outcome.keys.includes(movement.dedupeKey)).map((movement) => movement.sourceType.toLowerCase()))].join('/') || 'import';
    count.reconciliationNote = reconciliationNote(outcome, before, count.bookQty, sources);
    touchedLocations.add(count.locationId);
    await persistCountReconciliation(count, ownerOfLocation(count.locationId) ?? DEFAULT_COMPANY_ID);
    await persistAudit(recordAudit({
      actorId,
      actorRole: 'SYSTEM',
      action: outcome.action === 'ADJUST_PENDING' ? 'COUNT_BOOK_RECOMPUTED' : 'COUNT_RECONCILIATION_REQUIRED',
      entityType: 'StockCount',
      entityId: count.id,
      metadata: { lateDelta: outcome.lateDelta, movements: outcome.keys.length, bookBefore: before, bookAfter: count.bookQty },
    }));
  }
  for (const locationId of touchedLocations) {
    publishEvent({ topic: 'count.changed', companyId: ownerOfLocation(locationId) ?? DEFAULT_COMPANY_ID, locationIds: [locationId] });
  }
  return outcomes.length;
}

/** Never lets reconciliation bookkeeping fail the import that triggered it. */
export async function applyLateMovementsQuietly(movements: DailyMovementRecord[], actorId?: string): Promise<void> {
  try {
    await applyLateMovements(movements, actorId);
  } catch (error) {
    console.warn('Late movement reconciliation failed', error instanceof Error ? error.message : error);
  }
}

/** Counts the reviewer still has to look at because of late movements. */
export function countsNeedingReconciliation(): typeof counts {
  return counts.filter((count) => count.reconciliationRequired);
}
