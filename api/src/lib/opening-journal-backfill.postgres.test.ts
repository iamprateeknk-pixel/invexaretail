// The opening-journal backfill on real Postgres: balances with no history get exactly one opening row and
// then reconcile; a re-run adds nothing; a balance whose journal exists but disagrees (a REAL mismatch) is
// never touched; balances never change; other companies are untouched by a scoped run. Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { backfillOpeningJournal, findBackfillCandidates } from './opening-journal-backfill.js';
import { reconcileStock } from './stock-reconciliation.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function company(label: string) {
  const companyId = `obf-${label}-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const locationId = `obf-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'L', type: 'store', companyId } });
  return { companyId, locationId };
}

async function balance(companyId: string, locationId: string, onHand: number, journalDelta?: number) {
  const itemId = `obf-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: itemId, unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { lotNo: `L-${randomUUID().slice(0, 6)}`, itemId } });
  await prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand, companyId } });
  if (journalDelta !== undefined) {
    await prisma.stockMovement.create({ data: { itemId, lotId: lot.id, locationId, movementType: 'ADJUSTMENT', qtyDelta: journalDelta, beforeBalance: 0, afterBalance: journalDelta, timestamp: new Date(), companyId } });
  }
  return { itemId, lotId: lot.id };
}

integration('opening rows explain legacy balances, are idempotent, and never touch a real mismatch or a balance', async () => {
  const a = await company('a');
  const b = await company('b');
  const legacy1 = await balance(a.companyId, a.locationId, 40);
  const legacy2 = await balance(a.companyId, a.locationId, 7.5);
  await balance(a.companyId, a.locationId, 0); // a zero balance needs no opening row
  const healthy = await balance(a.companyId, a.locationId, 10, 10);
  const mismatch = await balance(a.companyId, a.locationId, 25, 20); // journal says 20, balance says 25
  const otherCompany = await balance(b.companyId, b.locationId, 9);

  const before = await reconcileStock({ companyId: a.companyId });
  assert.equal(before.noJournalHistory, 2, 'the two legacy balances are reported as baseline (a zero balance needs no explaining)');
  assert.equal(before.mismatches, 1);

  const dry = await backfillOpeningJournal({ companyId: a.companyId });
  assert.deepEqual([dry.applied, dry.inserted], [false, 0], 'a dry run writes nothing');
  assert.ok(dry.candidates >= 2);
  assert.equal((await findBackfillCandidates({ companyId: a.companyId })).some((c) => c.itemId === mismatch.itemId), false, 'a balance that has a journal is never a candidate');

  const applied = await backfillOpeningJournal({ companyId: a.companyId, apply: true });
  assert.equal(applied.inserted, 2, 'the two legacy balances with a non-zero amount get one row each');

  const after = await reconcileStock({ companyId: a.companyId });
  assert.equal(after.mismatches, 1, 'the real mismatch is still reported, not hidden');
  assert.equal(after.noJournalHistory, 0, 'every balance with something to explain now has a journal');

  const rows = await prisma.stockMovement.findMany({ where: { itemId: { in: [legacy1.itemId, legacy2.itemId] } } });
  assert.deepEqual(rows.map((row) => [row.movementType, Number(row.qtyDelta), Number(row.beforeBalance), Number(row.afterBalance), row.actor]).sort(),
    [['OPENING_STOCK', 40, 0, 40, 'opening-journal-backfill'], ['OPENING_STOCK', 7.5, 0, 7.5, 'opening-journal-backfill']].sort());

  // Balances untouched, healthy and mismatching journals untouched, other company untouched.
  const ledger = await prisma.stockLedger.findMany({ where: { companyId: a.companyId } });
  assert.deepEqual(ledger.map((row) => Number(row.onHand)).sort((x, y) => x - y), [0, 7.5, 10, 25, 40]);
  assert.equal(await prisma.stockMovement.count({ where: { itemId: healthy.itemId } }), 1);
  assert.equal(await prisma.stockMovement.count({ where: { itemId: mismatch.itemId } }), 1);
  assert.equal(await prisma.stockMovement.count({ where: { itemId: otherCompany.itemId } }), 0, 'a scoped run leaves other companies alone');

  const again = await backfillOpeningJournal({ companyId: a.companyId, apply: true });
  assert.equal(again.candidates, 0, 'a re-run finds nothing to do');
  assert.equal(again.inserted, 0);
});
