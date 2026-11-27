import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { DomainError } from './errors.js';
import type { CountRecord } from './repository.js';

type RevisionScope = { companyId: string; itemId: string; locationId: string; lotId?: string };
export type CountStockRevisionRow = { id: string; lotId: string; version: number; lastUpdatedAt: Date };

export function countStockRevision(scope: RevisionScope, rows: readonly CountStockRevisionRow[]): string {
  const versions = rows.map((row) => JSON.stringify([row.id, row.lotId, row.version, row.lastUpdatedAt.toISOString()])).sort();
  return createHash('sha256').update(JSON.stringify([scope.companyId, scope.itemId, scope.locationId, scope.lotId ?? null, versions])).digest('hex');
}

export function countStockChanged(): DomainError {
  return new DomainError('COUNT_STOCK_CHANGED', 'Stock changed since this count was started. Open the current task and count again.');
}

/** Validate the exact stock behind the submitted count and hold it through commit. */
export async function verifyCountStockRevision(
  tx: Prisma.TransactionClient,
  scope: RevisionScope,
  counts: readonly CountRecord[],
  expected: string,
): Promise<void> {
  const lotId = scope.lotId ?? null;
  const rows = await tx.$queryRaw<Array<CountStockRevisionRow & { onHand: Prisma.Decimal }>>`
    SELECT sl.id, sl."lotId", sl.version, sl."lastUpdatedAt", sl."onHand" FROM "StockLedger" AS sl
    JOIN "Lot" AS lot ON lot.id = sl."lotId" AND lot."itemId" = sl."itemId"
    WHERE sl."companyId" = ${scope.companyId} AND sl."itemId" = ${scope.itemId} AND sl."locationId" = ${scope.locationId}
      AND (${lotId}::text IS NULL OR sl."lotId" = ${lotId})
      AND sl."onHand" > 0 AND lot.status = 'AVAILABLE'
    ORDER BY sl.id
    FOR SHARE OF sl, lot
  `;
  const bookQuantities = new Map(rows.map((row) => [row.lotId, Number(row.onHand)]));
  if (countStockRevision(scope, rows) !== expected || rows.length !== counts.length ||
    counts.some((count) => bookQuantities.get(count.lotId) !== count.bookQty)) {
    throw countStockChanged();
  }
}
