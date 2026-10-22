// One place that turns a StockCount row into the CountRecord the API serves. Used by snapshot hydration
// (lib/persistence.ts) and by the database-first count repository, so the two cannot drift apart.
import type { CountRecord } from './repository.js';

import type { Prisma } from '@prisma/client';

type StockCountRow = {
  id: string; itemId: string; lotId: string; locationId: string; physicalQty: number | Prisma.Decimal; bookQty: number | Prisma.Decimal; mode: string;
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
    physicalQuantity: Number(count.physicalQty),
    bookQty: Number(count.bookQty),
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
    bookQtyOriginal: count.bookQtyOriginal == null ? undefined : Number(count.bookQtyOriginal as number | Prisma.Decimal),
    lateDelta: count.lateDelta == null ? 0 : Number(count.lateDelta as number | Prisma.Decimal),
    lateMovementKeys: Array.isArray(count.lateMovementKeys) ? (count.lateMovementKeys as string[]) : undefined,
  };
}
