// Plan Area B WP4 (reconciliation engine): make journal-vs-balance drift visible,
// measured and auditable, on a schedule and on demand, without ever editing history.
//
// The StockLedger row for (item, lot, location) is the live balance; the immutable
// StockMovement journal should explain it: sum(qtyDelta) == onHand. Two kinds of
// difference exist and they are NOT the same thing:
//   JOURNAL_MISMATCH   - the journal HAS movements for the row and they do not add up
//                        to the balance. A real defect (a write path skipped the journal
//                        or the balance was changed behind the service). Any > 0 is high
//                        severity.
//   NO_JOURNAL_HISTORY - balance exists with no journal at all: stock created by a legacy
//                        write path before the posting service (docs/inventory-posting-
//                        coverage.md). A measured baseline that must trend to zero as call
//                        sites migrate, reported separately so it never hides a mismatch.
// Reconciliation never rewrites a movement and never "fixes" a balance: a repair is a new,
// reasoned, audited movement through the posting service, decided by a person.
import { prisma } from './db.js';

export const RECONCILIATION_TOLERANCE = 1e-6;

export type ReconciliationException = {
  kind: 'JOURNAL_MISMATCH' | 'NO_JOURNAL_HISTORY';
  companyId: string;
  itemId: string;
  lotId: string;
  locationId: string;
  onHand: number;
  journalSum: number;
  movementCount: number;
  delta: number;
};

export type ReconciliationSummary = {
  companyId: string | null;
  ledgerRows: number;
  explained: number;
  mismatches: number;
  noJournalHistory: number;
  /** Sum of |delta| over JOURNAL_MISMATCH rows. */
  mismatchAbsDelta: number;
  maxAbsDelta: number;
  sample: ReconciliationException[];
};

export async function reconcileStock(options: { companyId?: string; sampleLimit?: number } = {}): Promise<ReconciliationSummary> {
  const companyId = options.companyId ?? null;
  const sampleLimit = Math.min(Math.max(options.sampleLimit ?? 50, 0), 500);
  const scope = companyId ? 'WHERE l."companyId" = $1' : '';
  const params = companyId ? [companyId] : [];

  // Aggregated in the database: never loads the ledger into memory.
  const totals = (await prisma.$queryRawUnsafe(
    `SELECT
       COUNT(*)::int AS ledger_rows,
       COUNT(*) FILTER (WHERE COALESCE(m.cnt, 0) = 0 AND ABS(l."onHand") > ${RECONCILIATION_TOLERANCE})::int AS no_journal,
       COUNT(*) FILTER (WHERE COALESCE(m.cnt, 0) > 0 AND ABS(l."onHand" - m.sum) > ${RECONCILIATION_TOLERANCE})::int AS mismatches,
       COALESCE(SUM(ABS(l."onHand" - m.sum)) FILTER (WHERE COALESCE(m.cnt, 0) > 0 AND ABS(l."onHand" - m.sum) > ${RECONCILIATION_TOLERANCE}), 0)::float AS mismatch_abs,
       COALESCE(MAX(ABS(l."onHand" - COALESCE(m.sum, 0))) FILTER (WHERE ABS(l."onHand" - COALESCE(m.sum, 0)) > ${RECONCILIATION_TOLERANCE}), 0)::float AS max_abs
     FROM "StockLedger" l
     LEFT JOIN (
       SELECT "itemId", "lotId", "locationId", SUM("qtyDelta") AS sum, COUNT(*) AS cnt
       FROM "StockMovement" WHERE "posted" = true GROUP BY "itemId", "lotId", "locationId"
     ) m ON m."itemId" = l."itemId" AND m."lotId" = l."lotId" AND m."locationId" = l."locationId"
     ${scope}`,
    ...params,
  )) as Array<{ ledger_rows: number; no_journal: number; mismatches: number; mismatch_abs: number; max_abs: number }>;
  const row = totals[0];
  const mismatches = Number(row?.mismatches ?? 0);
  const noJournal = Number(row?.no_journal ?? 0);
  const ledgerRows = Number(row?.ledger_rows ?? 0);

  let sample: ReconciliationException[] = [];
  if (sampleLimit > 0 && (mismatches > 0 || noJournal > 0)) {
    // Real mismatches first, then the legacy baseline, largest differences first.
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT l."companyId", l."itemId", l."lotId", l."locationId", l."onHand"::float AS on_hand,
              COALESCE(m.sum, 0)::float AS journal_sum, COALESCE(m.cnt, 0)::int AS movement_count
       FROM "StockLedger" l
       LEFT JOIN (
         SELECT "itemId", "lotId", "locationId", SUM("qtyDelta") AS sum, COUNT(*) AS cnt
         FROM "StockMovement" WHERE "posted" = true GROUP BY "itemId", "lotId", "locationId"
       ) m ON m."itemId" = l."itemId" AND m."lotId" = l."lotId" AND m."locationId" = l."locationId"
       ${companyId ? 'WHERE l."companyId" = $1 AND' : 'WHERE'} ABS(l."onHand" - COALESCE(m.sum, 0)) > ${RECONCILIATION_TOLERANCE}
       ORDER BY (COALESCE(m.cnt, 0) > 0) DESC, ABS(l."onHand" - COALESCE(m.sum, 0)) DESC
       LIMIT ${sampleLimit}`,
      ...params,
    )) as Array<{ companyId: string; itemId: string; lotId: string; locationId: string; on_hand: number; journal_sum: number; movement_count: number }>;
    sample = rows.map((r) => ({
      kind: r.movement_count > 0 ? 'JOURNAL_MISMATCH' : 'NO_JOURNAL_HISTORY',
      companyId: r.companyId, itemId: r.itemId, lotId: r.lotId, locationId: r.locationId,
      onHand: r.on_hand, journalSum: r.journal_sum, movementCount: r.movement_count, delta: r.on_hand - r.journal_sum,
    }));
  }

  return {
    companyId,
    ledgerRows,
    explained: ledgerRows - mismatches - noJournal,
    mismatches,
    noJournalHistory: noJournal,
    mismatchAbsDelta: Number(row?.mismatch_abs ?? 0),
    maxAbsDelta: Number(row?.max_abs ?? 0),
    sample,
  };
}

export type ReconciliationRunRecord = ReconciliationSummary & { id: string; startedAt: string; finishedAt: string; trigger: string };

/** Runs a reconciliation and records it, so "when did we last check and what did we find" is answerable. */
export async function runAndRecordReconciliation(options: { companyId?: string; trigger?: 'schedule' | 'manual'; sampleLimit?: number } = {}): Promise<ReconciliationRunRecord> {
  const startedAt = new Date();
  const summary = await reconcileStock({ companyId: options.companyId, sampleLimit: options.sampleLimit });
  const finishedAt = new Date();
  const saved = await prisma.reconciliationRun.create({
    data: {
      companyId: options.companyId ?? null,
      trigger: options.trigger ?? 'manual',
      startedAt, finishedAt,
      ledgerRows: summary.ledgerRows,
      explained: summary.explained,
      mismatches: summary.mismatches,
      noJournalHistory: summary.noJournalHistory,
      mismatchAbsDelta: summary.mismatchAbsDelta,
      maxAbsDelta: summary.maxAbsDelta,
      sampleJson: JSON.stringify(summary.sample.slice(0, 50)),
    },
  });
  return { ...summary, id: saved.id, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), trigger: saved.trigger };
}

export async function latestReconciliation(companyId?: string): Promise<ReconciliationRunRecord | null> {
  const row = await prisma.reconciliationRun.findFirst({ where: { companyId: companyId ?? null }, orderBy: { startedAt: 'desc' } });
  if (!row) return null;
  return {
    id: row.id, companyId: row.companyId, trigger: row.trigger,
    startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt.toISOString(),
    ledgerRows: row.ledgerRows, explained: row.explained, mismatches: row.mismatches, noJournalHistory: row.noJournalHistory,
    mismatchAbsDelta: row.mismatchAbsDelta, maxAbsDelta: row.maxAbsDelta,
    sample: JSON.parse(row.sampleJson) as ReconciliationException[],
  };
}

/** SLO: any unexplained JOURNAL_MISMATCH is a breach; the legacy baseline is reported, not alerted. */
export function reconciliationBreached(run: Pick<ReconciliationSummary, 'mismatches'> | null): boolean {
  return Boolean(run && run.mismatches > 0);
}

export async function pruneReconciliationRuns(keepDays = 90): Promise<number> {
  return (await prisma.reconciliationRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - keepDays * 86_400_000) } } })).count;
}
