import { Prisma } from '@prisma/client';

// Legacy bulk stock changes (Stock Update opening/daily/adjustment imports and their reversal) set or
// shift StockLedger balances in bulk with raw SQL and keep their own InventoryMovement history. They
// never wrote the canonical StockMovement journal, so every import re-opened the "balance with no
// explanation" gap that reconciliation reports.
//
// This brings the journal back in line INSIDE the same transaction: for the (item, lot, location)
// balances the import just touched, it adds ONE StockMovement row whose quantity is exactly the
// difference between the balance and what the journal already adds up to. For a balance with no history
// that is the whole balance (an opening row); for one already journalled it is just this import's net
// change; for a reversal it is the negative of the import.
//
// It only ever ADDS a row, never edits a balance or an existing movement, is idempotent per batch (a
// deterministic key per balance), and writes nothing when journal and balance already agree.

export type JournalKey = { itemId: string; lotId: string; locationId: string };

export type JournalSyncOptions = {
  companyId: string;
  batchId: string;
  actor: string;
  movementType: 'OPENING_STOCK' | 'ADJUSTMENT' | 'SALES_DEDUCTION' | 'PURCHASE_RECEIPT';
  reason: string;
};

type Executor = { $executeRaw: (query: Prisma.Sql) => Promise<number> };

const CHUNK = 400;
const TOLERANCE = 1e-6;

/** Maps a legacy import type to the journal movement type that describes its net effect. */
export function journalTypeForImport(importType: string): JournalSyncOptions['movementType'] {
  const type = importType.toUpperCase();
  if (type === 'SALES') return 'SALES_DEDUCTION';
  if (type === 'PURCHASE') return 'PURCHASE_RECEIPT';
  if (type === 'OPENING_STOCK') return 'OPENING_STOCK';
  return 'ADJUSTMENT';
}

export async function syncJournalToBalances(tx: Executor, keys: JournalKey[], options: JournalSyncOptions): Promise<number> {
  const unique = new Map<string, JournalKey>();
  for (const key of keys) unique.set(`${key.itemId}\u0000${key.lotId}\u0000${key.locationId}`, key);
  const list = [...unique.values()];
  let inserted = 0;
  for (let offset = 0; offset < list.length; offset += CHUNK) {
    const chunk = list.slice(offset, offset + CHUNK);
    const values = Prisma.join(chunk.map((key) => Prisma.sql`(${key.itemId}, ${key.lotId}, ${key.locationId})`), ', ');
    inserted += await tx.$executeRaw(Prisma.sql`
      INSERT INTO "StockMovement"
        (id, "itemId", "lotId", "locationId", "movementType", "qtyDelta", "beforeBalance", "afterBalance",
         "sourceDocument", actor, "timestamp", posted, "companyId", "idempotencyKey", reason, "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, l."itemId", l."lotId", l."locationId", ${options.movementType}::"StockMovementType",
             l."onHand" - COALESCE(j.total, 0), COALESCE(j.total, 0), l."onHand",
             ${options.batchId}, ${options.actor}, NOW(), true, l."companyId",
             ${`import-sync:${options.batchId}:`} || l."itemId" || ':' || l."lotId" || ':' || l."locationId",
             ${options.reason}, NOW(), NOW()
      FROM "StockLedger" l
      LEFT JOIN (
        SELECT m."itemId", m."lotId", m."locationId", SUM(m."qtyDelta") AS total
        FROM "StockMovement" m
        WHERE m.posted = true AND (m."itemId", m."lotId", m."locationId") IN (${values})
        GROUP BY m."itemId", m."lotId", m."locationId"
      ) j ON j."itemId" = l."itemId" AND j."lotId" = l."lotId" AND j."locationId" = l."locationId"
      WHERE l."companyId" = ${options.companyId}
        AND (l."itemId", l."lotId", l."locationId") IN (${values})
        AND ABS(l."onHand" - COALESCE(j.total, 0)) > ${TOLERANCE}
      ON CONFLICT ("companyId", "idempotencyKey") DO NOTHING
    `);
  }
  return inserted;
}
