// Plan P1-STOCK-001 on real Postgres: job consumption is one transaction on the
// canonical posting service, with a caller-supplied idempotency key. These tests
// pin the two defects of the old route (concurrent requests sharing a derived key;
// a retry getting a different key) and the rule that the database, not process
// memory, decides what is available. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { consumeJobLine, JobConsumeError } from './job-consumption-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeFixture(options: { onHand?: number; reserved?: number } = {}) {
  const companyId = `job-consume-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `job-consume-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Job Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const locationId = `job-consume-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Loc', type: 'warehouse', companyId } });
  const itemId = `job-consume-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand: options.onHand ?? 100, reserved: options.reserved ?? 0, companyId } });
  const job = await prisma.job.create({ data: { number: `J-${randomUUID().slice(0, 8)}`, companyId, name: 'Job', locationId, status: 'ACTIVE', createdById: userId, lines: { create: [{ itemId, plannedQty: 100 }] } }, include: { lines: true } });
  const tenant = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' as const };
  return { companyId, userId, locationId, itemId, lotId: lot.id, job, line: job.lines[0], tenant };
}

const consume = (f: Awaited<ReturnType<typeof makeFixture>>, quantity: number, requestId: string, extra: Partial<Parameters<typeof consumeJobLine>[0]> = {}) =>
  consumeJobLine({ tenant: f.tenant, jobId: f.job.id, lineId: f.line.id, quantity, requestId, strategy: 'FEFO', canAccessLocation: () => true, ...extra });

const ledger = (f: Awaited<ReturnType<typeof makeFixture>>) => prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.itemId, locationId: f.locationId } });
const lineNow = (f: Awaited<ReturnType<typeof makeFixture>>) => prisma.jobLine.findUniqueOrThrow({ where: { id: f.line.id } });

integration('two different consume actions at the same time both apply: stock and the line counters stay in step', async () => {
  const f = await makeFixture();
  const [a, b] = await Promise.all([consume(f, 3, `req-${randomUUID()}`), consume(f, 4, `req-${randomUUID()}`)]);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, false);
  assert.equal((await ledger(f)).onHand, 93, '100 - 3 - 4: neither request was swallowed as a "duplicate" of the other');
  const line = await lineNow(f);
  assert.equal(line.issuedQty, 7);
  assert.equal(line.usedQty, 7);
  const movements = await prisma.stockMovement.findMany({ where: { sourceLineId: f.line.id } });
  assert.equal(movements.reduce((sum, m) => sum + m.qtyDelta, 0), -7, 'the journal sums to exactly what the line says was used');
});

integration('a client retry of the same action (same requestId) after success consumes nothing more', async () => {
  const f = await makeFixture();
  const requestId = `req-${randomUUID()}`;
  const first = await consume(f, 5, requestId);
  const retry = await consume(f, 5, requestId);
  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.allocations.map((a) => a.quantity), first.allocations.map((a) => a.quantity), 'the retry reports the original allocation');
  assert.equal((await ledger(f)).onHand, 95, 'the old route consumed 5 more here');
  assert.equal((await lineNow(f)).issuedQty, 5);
});

integration('six simultaneous retries of one action run exactly once', async () => {
  const f = await makeFixture();
  const requestId = `req-${randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 6 }, () => consume(f, 10, requestId)));
  assert.equal(results.filter((r) => !r.duplicate).length, 1, 'exactly one real execution');
  assert.equal((await ledger(f)).onHand, 90);
  assert.equal((await lineNow(f)).issuedQty, 10);
  assert.equal(await prisma.stockMovement.count({ where: { sourceLineId: f.line.id } }), 1);
});

integration('the database decides availability: a shortage is refused and nothing is posted', async () => {
  const f = await makeFixture({ onHand: 4 });
  await assert.rejects(consume(f, 5, `req-${randomUUID()}`), (error) => error instanceof JobConsumeError && error.status === 409 && /Only 4/.test(error.message));
  assert.equal((await ledger(f)).onHand, 4);
  assert.equal((await lineNow(f)).issuedQty, 0);
  assert.equal(await prisma.stockMovement.count({ where: { sourceLineId: f.line.id } }), 0);
});

integration('stock reserved for orders or transfers is not available to a job', async () => {
  const f = await makeFixture({ onHand: 10, reserved: 8 });
  await assert.rejects(consume(f, 5, `req-${randomUUID()}`), (error) => error instanceof JobConsumeError && error.status === 409);
  const ok = await consume(f, 2, `req-${randomUUID()}`);
  assert.equal(ok.duplicate, false);
  assert.equal((await ledger(f)).onHand, 8);
  assert.equal((await ledger(f)).reserved, 8, 'the reservation is untouched');
});

integration('an inactive job, a foreign job and a foreign location are refused', async () => {
  const f = await makeFixture();
  const other = await makeFixture();
  await prisma.job.update({ where: { id: f.job.id }, data: { status: 'DRAFT' } });
  await assert.rejects(consume(f, 1, `req-${randomUUID()}`), (error) => error instanceof JobConsumeError && error.status === 409);
  await prisma.job.update({ where: { id: f.job.id }, data: { status: 'ACTIVE' } });
  await assert.rejects(consumeJobLine({ tenant: other.tenant, jobId: f.job.id, lineId: f.line.id, quantity: 1, requestId: 'req-x1', strategy: 'FEFO', canAccessLocation: () => true }), (error) => error instanceof JobConsumeError && error.status === 404, 'another company sees a missing job, not a forbidden one');
  await assert.rejects(consume(f, 1, `req-${randomUUID()}`, { canAccessLocation: () => false }), (error) => error instanceof JobConsumeError && error.status === 403);
  assert.equal((await ledger(f)).onHand, 100);
});

integration('fractional or non-positive quantities and a missing key are rejected before any work', async () => {
  const f = await makeFixture();
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(consume(f, quantity, `req-${randomUUID()}`), (error) => error instanceof JobConsumeError && error.status === 400, String(quantity));
  }
  await assert.rejects(consume(f, 1, ''), (error) => error instanceof JobConsumeError && error.status === 400);
  assert.equal((await ledger(f)).onHand, 100);
});

integration('a consume across two lots takes FEFO order from the database and records one movement per lot', async () => {
  const f = await makeFixture({ onHand: 3 });
  const soon = new Date(Date.now() + 10 * 86_400_000);
  const later = new Date(Date.now() + 100 * 86_400_000);
  await prisma.lot.update({ where: { id: f.lotId }, data: { expiryDate: later } });
  const early = await prisma.lot.create({ data: { itemId: f.itemId, lotNo: `EARLY-${randomUUID().slice(0, 6)}`, expiryDate: soon } });
  await prisma.stockLedger.create({ data: { itemId: f.itemId, lotId: early.id, locationId: f.locationId, onHand: 2, companyId: f.companyId } });
  const result = await consume(f, 4, `req-${randomUUID()}`);
  assert.deepEqual(result.allocations.map((a) => [a.lotId, a.quantity]), [[early.id, 2], [f.lotId, 2]], 'earliest expiry first');
  assert.equal(await prisma.stockMovement.count({ where: { sourceLineId: f.line.id } }), 2);
  assert.equal((await lineNow(f)).issuedQty, 4);
});
