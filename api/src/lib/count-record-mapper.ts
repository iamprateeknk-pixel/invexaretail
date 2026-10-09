// One place that turns a StockCount row into the CountRecord the API serves. Used by snapshot hydration
// (lib/persistence.ts) and by the database-first count repository, so the two cannot drift apart.
import type { CountRecord } from './repository.js';

type StockCountRow = {
  id: string; itemId: string; lotId: string; locationId: string; physicalQty: number; bookQty: number; mode: string;
  submittedById: string; createdAt: Date; reviewStatus: string; approvedById: string | null; approvedAt: Date | null;
  reviewReason: string | null; parentCountId: string | null;
};

export function countRowToRecord(row: StockCountRow, role: CountRecord['role']): CountRecord {
  const count = row as StockCountRow & Record<string, unknown>;
  return {
    id: count.id,
    itemId: count.itemId,
    lotId: count.lotId,
    locationId: count.locationId,
    physicalQuantity: count.physicalQty,
    bookQty: count.bookQty,
    mode: count.mode as 'scan' | 'manual' | 'weight',
    submittedBy: count.submittedById,
    role,
    createdAt: count.createdAt.toISOString(),
    status: count.reviewStatus as 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW' | 'RECOUNT',
    reviewedBy: count.approvedById ?? undefined,
    reviewedAt: count.approvedAt?.toISOString(),
    reviewReason: count.reviewReason ?? undefined,
    reasonCode: (count.reasonCode as string | null | undefined) ?? undefined,
    parentCountId: count.parentCountId ?? undefined,
    requestId: (count.requestId as string | null | undefined) ?? undefined,
    reconciliationRequired: (count.reconciliationRequired as boolean | undefined) ?? false,
    reconciliationNote: (count.reconciliationNote as string | null | undefined) ?? undefined,
    reconciliationAt: (count.reconciliationAt as Date | null | undefined)?.toISOString(),
    bookQtyOriginal: (count.bookQtyOriginal as number | null | undefined) ?? undefined,
    lateDelta: (count.lateDelta as number | undefined) ?? 0,
    lateMovementKeys: Array.isArray(count.lateMovementKeys) ? (count.lateMovementKeys as string[]) : undefined,
  };
}
