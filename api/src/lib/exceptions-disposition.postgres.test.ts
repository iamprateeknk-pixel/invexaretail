// Week 6: an exception disposition moves stock out of quarantine. Restock goes
// back on-hand through the canonical service; a write-off is a bucket move and
// must not change the on-hand journal sum. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { applyExceptionDisposition } from './exceptions.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function setup() {
  const companyId = `exc-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `exc-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'E', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const loc = await prisma.location.create({ data: { id: `exc-loc-${randomUUID()}`, code: `exc-${randomUUID()}`, name: 'L', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `EXC-${randomUUID().slice(0, 8)}`, name: 'I', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: loc.id, onHand: 5, quarantine: 4, companyId } });
  const exceptionCase = await prisma.exceptionCase.create({
    data: { type: 'DAMAGE', title: 't', description: 'd', itemId: item.id, lotId: lot.id, locationId: loc.id, quantity: 3, reportedById: userId, companyId } as never,
  });
  return { companyId, userId, loc, item, exceptionCase };
}

integration('RESTOCK moves quarantine back on-hand with one canonical journal row', async () => {
  const f = await setup();
  await applyExceptionDisposition(f.exceptionCase, 'RESTOCK', f.userId);
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
  assert.equal(Number(ledger.onHand), 8);
  assert.equal(Number(ledger.quarantine), 1);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: f.item.id } });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].qtyDelta), 3);
  assert.equal(rows[0].companyId, f.companyId);
});

integration('WRITE_OFF is a bucket move: damaged rises, on-hand is untouched, journal delta is zero', async () => {
  const f = await setup();
  await applyExceptionDisposition(f.exceptionCase, 'WRITE_OFF', f.userId);
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
  assert.equal(Number(ledger.onHand), 5);
  assert.equal(Number(ledger.quarantine), 1);
  assert.equal(Number(ledger.damaged), 3);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: f.item.id } });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].qtyDelta), 0);
});
