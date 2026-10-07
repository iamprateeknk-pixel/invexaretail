import { prisma } from './db.js';

// Release checklist (Stock / database): "Journal and balance projection have zero unexplained
// reconciliation deltas." Balances created by call sites that predate the posting service have no
// journal at all (reported as NO_JOURNAL_HISTORY - a baseline, not an error). This gives every such
// balance ONE honest opening-balance journal row, exactly like a stock take that starts the books:
//
//   qtyDelta = the balance as it stands, beforeBalance 0, afterBalance = the balance,
//   movementType OPENING_STOCK, actor "opening-journal-backfill", reason says so.
//
// It never edits a balance and never edits or deletes a movement: it only ADDS the missing opening row.
// Idempotent (a deterministic key per item/lot/location, so a re-run adds nothing), dry-run first, and it
// only touches balances that have NO posted movement - a balance whose journal exists but disagrees is a
// real mismatch and is left for a human, never papered over.

export const BACKFILL_ACTOR = 'opening-journal-backfill';
const BATCH = 500;

export type BackfillCandidate = { companyId: string; itemId: string; lotId: string; locationId: string; onHand: number };

export const backfillKey = (c: Pick<BackfillCandidate, 'itemId' | 'lotId' | 'locationId'>) => `opening-backfill:${c.itemId}:${c.lotId}:${c.locationId}`;

/** Ledger rows with a non-zero balance and no posted movement at all. */
export async function findBackfillCandidates(options: { companyId?: string } = {}): Promise<BackfillCandidate[]> {
  const params: unknown[] = [];
  const scope = options.companyId ? (params.push(options.companyId), `AND l."companyId" = $${params.length}`) : '';
  return (await prisma.$queryRawUnsafe(
    `SELECT l."companyId", l."itemId", l."lotId", l."locationId", l."onHand"::float AS "onHand"
     FROM "StockLedger" l
     WHERE l."onHand" <> 0 ${scope}
       AND NOT EXISTS (
         SELECT 1 FROM "StockMovement" m
         WHERE m."itemId" = l."itemId" AND m."lotId" = l."lotId" AND m."locationId" = l."locationId" AND m."posted" = true
       )
     ORDER BY l."companyId", l."locationId", l."itemId"`,
    ...params,
  )) as BackfillCandidate[];
}

export type BackfillResult = { candidates: number; inserted: number; applied: boolean };

export async function backfillOpeningJournal(options: { companyId?: string; apply?: boolean; now?: Date } = {}): Promise<BackfillResult> {
  const candidates = await findBackfillCandidates({ companyId: options.companyId });
  if (!options.apply || candidates.length === 0) return { candidates: candidates.length, inserted: 0, applied: Boolean(options.apply) };
  const at = options.now ?? new Date();
  let inserted = 0;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const result = await prisma.stockMovement.createMany({
      skipDuplicates: true,
      data: batch.map((c) => ({
        itemId: c.itemId, lotId: c.lotId, locationId: c.locationId, companyId: c.companyId,
        movementType: 'OPENING_STOCK' as const, qtyDelta: c.onHand, beforeBalance: 0, afterBalance: c.onHand,
        actor: BACKFILL_ACTOR, timestamp: at, posted: true, idempotencyKey: backfillKey(c),
        reason: 'Opening balance journalled so the movement journal explains this balance. No stock changed.',
      })),
    });
    inserted += result.count;
  }
  return { candidates: candidates.length, inserted, applied: true };
}
