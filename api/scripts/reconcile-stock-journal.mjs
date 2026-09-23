#!/usr/bin/env node
// ADR-001 / Week 6: reconciliation between the immutable StockMovement
// journal and the StockLedger projection it is supposed to explain.
//
// This does NOT hide mismatches. Most StockLedger rows today were built by
// one of the ~20+ legacy call sites that predate InventoryPostingService
// (see docs/inventory-posting-coverage.md) and so have no matching
// StockMovement history at all - that is an expected, large "exception"
// count until those call sites migrate, not a bug in this script. Its job
// is to make that gap measurable, not to explain it away.
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/reconcile-stock-journal.mjs
//   node scripts/reconcile-stock-journal.mjs --json   # machine-readable exception list
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const TOLERANCE = 1e-6;

async function main() {
  const [ledgerRows, movementSums] = await Promise.all([
    prisma.stockLedger.findMany({ select: { id: true, itemId: true, lotId: true, locationId: true, onHand: true, companyId: true } }),
    prisma.$queryRawUnsafe(
      `SELECT "itemId", "lotId", "locationId", COALESCE(SUM("qtyDelta"), 0) AS journal_sum, COUNT(*) AS movement_count
       FROM "StockMovement" GROUP BY "itemId", "lotId", "locationId"`,
    ),
  ]);

  const journalByKey = new Map(
    movementSums.map((row) => [
      `${row.itemId}\u0000${row.lotId}\u0000${row.locationId}`,
      { journalSum: Number(row.journal_sum), movementCount: Number(row.movement_count) },
    ]),
  );

  const exceptions = [];
  let explained = 0;
  let noJournalAtAll = 0;

  for (const ledger of ledgerRows) {
    const key = `${ledger.itemId}\u0000${ledger.lotId}\u0000${ledger.locationId}`;
    const journal = journalByKey.get(key);
    if (!journal) {
      noJournalAtAll += 1;
      exceptions.push({
        kind: 'NO_JOURNAL_HISTORY',
        companyId: ledger.companyId,
        itemId: ledger.itemId,
        lotId: ledger.lotId,
        locationId: ledger.locationId,
        onHand: ledger.onHand,
        journalSum: 0,
        delta: ledger.onHand,
      });
      continue;
    }
    const delta = ledger.onHand - journal.journalSum;
    if (Math.abs(delta) > TOLERANCE) {
      exceptions.push({
        kind: 'JOURNAL_MISMATCH',
        companyId: ledger.companyId,
        itemId: ledger.itemId,
        lotId: ledger.lotId,
        locationId: ledger.locationId,
        onHand: ledger.onHand,
        journalSum: journal.journalSum,
        movementCount: journal.movementCount,
        delta,
      });
    } else {
      explained += 1;
    }
  }

  const summary = {
    totalLedgerRows: ledgerRows.length,
    explainedByJournal: explained,
    noJournalHistory: noJournalAtAll,
    journalMismatch: exceptions.length - noJournalAtAll,
    exceptionCount: exceptions.length,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ summary, exceptions }, null, 2));
  } else {
    console.log('Stock journal reconciliation');
    console.log('============================');
    console.log(`Total StockLedger rows:        ${summary.totalLedgerRows}`);
    console.log(`Fully explained by journal:    ${summary.explainedByJournal}`);
    console.log(`No journal history at all:     ${summary.noJournalHistory}  (expected - legacy call sites predate InventoryPostingService)`);
    console.log(`Journal sum != onHand:         ${summary.journalMismatch}  (a real bug if nonzero for a row WITH journal history)`);
    if (summary.journalMismatch > 0) {
      console.log('\nJOURNAL_MISMATCH exceptions (journal history exists but does not sum to onHand):');
      for (const row of exceptions.filter((e) => e.kind === 'JOURNAL_MISMATCH')) {
        console.log(`  ${row.itemId}/${row.lotId}/${row.locationId}: onHand=${row.onHand} journalSum=${row.journalSum} delta=${row.delta} (${row.movementCount} movements)`);
      }
    }
  }

  await prisma.$disconnect();
  // Exit non-zero only for the real-bug case (journal exists but disagrees),
  // never for the expected "no journal yet" gap - CI can gate on this once
  // enough call sites have migrated that a mismatch would be meaningful.
  process.exit(summary.journalMismatch > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
