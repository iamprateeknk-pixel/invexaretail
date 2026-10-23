// Plan Area B WP4 on real Postgres: reconciliation finds a drift the journal cannot
// explain, separates it from the legacy "no journal at all" baseline, is company
// scoped, is recorded as evidence, and never changes stock or history.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { postInventoryMovement } from './inventory-posting-service.js';
import { latestReconciliation, reconcileStock, reconciliationBreached, runAndRecordReconciliation } from './stock-reconciliation.js';
import { generateJWT } from './otp-auth.js';
import { createEnhancedUser } from './enterprise-repository.js';
import commandCenterRouter from '../routes/command-center.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeCompany() {
  const companyId = `recon-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `recon-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Recon Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Recon Admin', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const locationId = `recon-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Loc', type: 'warehouse', companyId } });
  const tenant = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' as const };
  const row = async (onHand: number) => {
    const itemId = `recon-item-${randomUUID()}`;
    await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Item', unit: 'ea', companyId } });
    const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
    return { itemId, lotId: lot.id, onHand };
  };
  return { companyId, userId, locationId, tenant, row, token: generateJWT(userId, companyId) };
}

integration('a journaled balance reconciles; a balance changed behind the service shows as a mismatch; a legacy balance with no journal is the separate baseline', async () => {
  const c = await makeCompany();
  // 1. clean: posted through the canonical service (journal and balance move together)
  const clean = await c.row(0);
  await postInventoryMovement({ tenant: c.tenant, itemId: clean.itemId, lotId: clean.lotId, locationId: c.locationId, movementType: 'ADJUSTMENT', qtyDelta: 10, idempotencyKey: `k-${randomUUID()}`, reason: 'opening' });
  // 2. drift: journaled, then the balance is altered directly (a write path that skipped the journal)
  const drift = await c.row(0);
  await postInventoryMovement({ tenant: c.tenant, itemId: drift.itemId, lotId: drift.lotId, locationId: c.locationId, movementType: 'ADJUSTMENT', qtyDelta: 20, idempotencyKey: `k-${randomUUID()}`, reason: 'opening' });
  await prisma.stockLedger.updateMany({ where: { itemId: drift.itemId, lotId: drift.lotId }, data: { onHand: 23 } });
  // 3. legacy: a balance that was never journaled
  const legacy = await c.row(0);
  await prisma.stockLedger.create({ data: { itemId: legacy.itemId, lotId: legacy.lotId, locationId: c.locationId, onHand: 5, companyId: c.companyId } });

  const summary = await reconcileStock({ companyId: c.companyId });
  assert.equal(summary.ledgerRows, 3);
  assert.equal(summary.explained, 1);
  assert.equal(summary.mismatches, 1);
  assert.equal(summary.noJournalHistory, 1);
  assert.equal(summary.mismatchAbsDelta, 3, 'ledger 23 vs journal 20');
  assert.equal(summary.maxAbsDelta, 5, 'the legacy 5 is the largest single difference');
  assert.equal(reconciliationBreached(summary), true, 'a real mismatch is a breach');

  const kinds = Object.fromEntries(summary.sample.map((e) => [e.itemId, e.kind]));
  assert.equal(kinds[drift.itemId], 'JOURNAL_MISMATCH');
  assert.equal(kinds[legacy.itemId], 'NO_JOURNAL_HISTORY');
  assert.equal(summary.sample[0].kind, 'JOURNAL_MISMATCH', 'real mismatches are listed before the legacy baseline');
  assert.equal(summary.sample.find((e) => e.itemId === drift.itemId)!.delta, 3);
});

integration('the legacy baseline alone is not a breach', async () => {
  const c = await makeCompany();
  const legacy = await c.row(0);
  await prisma.stockLedger.create({ data: { itemId: legacy.itemId, lotId: legacy.lotId, locationId: c.locationId, onHand: 12, companyId: c.companyId } });
  const summary = await reconcileStock({ companyId: c.companyId });
  assert.equal(summary.noJournalHistory, 1);
  assert.equal(summary.mismatches, 0);
  assert.equal(reconciliationBreached(summary), false);
});

integration('reconciliation is company scoped: another company\'s drift never appears', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const rowA = await a.row(0);
  await prisma.stockLedger.create({ data: { itemId: rowA.itemId, lotId: rowA.lotId, locationId: a.locationId, onHand: 9, companyId: a.companyId } });
  const forB = await reconcileStock({ companyId: b.companyId });
  assert.equal(forB.ledgerRows, 0);
  assert.equal(forB.sample.length, 0);
  const forA = await reconcileStock({ companyId: a.companyId });
  assert.equal(forA.ledgerRows, 1);
  assert.ok(forA.sample.every((e) => e.companyId === a.companyId));
});

integration('a run is recorded as evidence and never changes stock or the journal', async () => {
  const c = await makeCompany();
  const drift = await c.row(0);
  await postInventoryMovement({ tenant: c.tenant, itemId: drift.itemId, lotId: drift.lotId, locationId: c.locationId, movementType: 'ADJUSTMENT', qtyDelta: 8, idempotencyKey: `k-${randomUUID()}`, reason: 'opening' });
  await prisma.stockLedger.updateMany({ where: { itemId: drift.itemId }, data: { onHand: 7 } });
  const movementsBefore = await prisma.stockMovement.count({ where: { companyId: c.companyId } });

  const run = await runAndRecordReconciliation({ companyId: c.companyId, trigger: 'manual' });
  assert.equal(run.mismatches, 1);
  const latest = await latestReconciliation(c.companyId);
  assert.equal(latest?.id, run.id);
  assert.equal(latest?.trigger, 'manual');
  assert.equal(latest?.sample[0].itemId, drift.itemId);

  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: drift.itemId } })).onHand), 7, 'the balance is left exactly as found');
  assert.equal(await prisma.stockMovement.count({ where: { companyId: c.companyId } }), movementsBefore, 'no movement is created or edited');
});

integration('the sample limit bounds the report on a large drift', async () => {
  const c = await makeCompany();
  for (let i = 0; i < 6; i += 1) {
    const r = await c.row(0);
    await prisma.stockLedger.create({ data: { itemId: r.itemId, lotId: r.lotId, locationId: c.locationId, onHand: i + 1, companyId: c.companyId } });
  }
  const summary = await reconcileStock({ companyId: c.companyId, sampleLimit: 3 });
  assert.equal(summary.noJournalHistory, 6, 'the count is exact');
  assert.equal(summary.sample.length, 3, 'the listing is bounded');
  assert.deepEqual(summary.sample.map((e) => e.delta), [6, 5, 4], 'largest differences first');
});

integration('GET /ops/reconciliation and POST /ops/reconciliation/run are admin-only and only see the caller\'s company', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const rowA = await a.row(0);
  await prisma.stockLedger.create({ data: { itemId: rowA.itemId, lotId: rowA.lotId, locationId: a.locationId, onHand: 4, companyId: a.companyId } });
  const app = express();
  app.use(express.json());
  app.use('/api/v1', commandCenterRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const call = async (method: string, path: string, token: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try {
    assert.equal((await call('GET', '/ops/reconciliation', a.token)).body.latest, null, 'nothing recorded yet');
    const run = await call('POST', '/ops/reconciliation/run', a.token);
    assert.equal(run.status, 201);
    assert.equal(run.body.latest.noJournalHistory, 1);
    const asB = await call('GET', '/ops/reconciliation', b.token);
    assert.equal(asB.body.latest, null, 'company B sees none of company A\'s runs');
    const asA = await call('GET', '/ops/reconciliation', a.token);
    assert.equal(asA.body.latest.id, run.body.latest.id);
    assert.ok(asA.body.latest.sample.every((e: { companyId: string }) => e.companyId === a.companyId));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
