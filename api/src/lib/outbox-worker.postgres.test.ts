// Week 7 mandatory verification: "Worker crash between business commit and
// publish does not lose the event" and "Duplicate delivery is harmless and
// poison events become visible exceptions." Exercised against real
// Postgres - see AGENTS.md "Required tests". Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma, executeRaw } from './db.js';
import { recordOutboxEventInTransaction } from './event-bus.js';
import { drainOutboxOnce, listPoisonEvents, requeuePoisonEvent, MAX_DELIVERY_ATTEMPTS } from './outbox-worker.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

// These tests drain the whole table and assert on the claim counts, so they
// need an otherwise empty outbox. Other Postgres suites (imports, reporting,
// route slices) leave PENDING rows behind, and CI runs every suite against
// one database - start from a clean table so suite order cannot matter.
before(async () => {
  if (databaseUrl) await prisma.$executeRawUnsafe('DELETE FROM "DomainEventOutbox"');
});

async function insertPendingEvent(companyId = `outbox-test-${randomUUID()}`): Promise<bigint> {
  await prisma.$transaction(async (tx) => {
    await recordOutboxEventInTransaction(tx as never, { topic: 'stock.changed', companyId, locationIds: ['loc-1'] });
  });
  const [row] = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
    `SELECT id FROM "DomainEventOutbox" WHERE "companyId" = $1 ORDER BY id DESC LIMIT 1`,
    companyId,
  );
  return row.id;
}

integration('an event written in the same transaction as business state is durably PENDING until delivered', async () => {
  const companyId = `outbox-test-${randomUUID()}`;
  const id = await insertPendingEvent(companyId);
  const [row] = await prisma.$queryRawUnsafe<Array<{ status: string }>>(`SELECT status FROM "DomainEventOutbox" WHERE id = $1`, id);
  assert.equal(row.status, 'PENDING');
});

integration('a worker crash between claiming and processing does not lose the event - it becomes available again after its lease expires', async () => {
  const id = await insertPendingEvent();
  // Simulate a worker that claimed the row (lease pushed forward) and then
  // crashed before marking it delivered: force the lease into the past, as
  // if the 30s claim window had already elapsed, and confirm a fresh drain
  // still picks it up rather than treating "not yet DELIVERED" as lost.
  await executeRaw(prisma, `UPDATE "DomainEventOutbox" SET status = 'PENDING', "availableAt" = now() - interval '1 second' WHERE id = ?`, id);
  const delivered: bigint[] = [];
  const result = await drainOutboxOnce(async (event) => { delivered.push(BigInt(event.id)); });
  assert.ok(result.delivered >= 1);
  assert.ok(delivered.includes(id), 'the event must still be delivered after simulating a crashed prior claim');
  const [row] = await prisma.$queryRawUnsafe<Array<{ status: string }>>(`SELECT status FROM "DomainEventOutbox" WHERE id = $1`, id);
  assert.equal(row.status, 'DELIVERED');
});

integration('duplicate delivery is harmless: redelivering an already-DELIVERED event is not attempted, and re-running the handler manually for the same id is idempotent by design', async () => {
  const id = await insertPendingEvent();
  const calls: bigint[] = [];
  await drainOutboxOnce(async (event) => { calls.push(BigInt(event.id)); });
  const secondDrain = await drainOutboxOnce(async (event) => { calls.push(BigInt(event.id)); });
  assert.equal(secondDrain.claimed, 0, 'a DELIVERED row must never be re-claimed by a later drain');
  assert.equal(calls.filter((c) => c === id).length, 1, 'the handler must have been invoked exactly once across both drains');
});

integration('a handler that always fails is retried with backoff and eventually becomes a visible POISON exception', async () => {
  const id = await insertPendingEvent();
  // The suite runs alongside other .postgres.test.ts files against the same
  // database (AGENTS.md's documented cross-test state-sharing caveat), so a
  // drain can also claim unrelated PENDING rows left by other suites in the
  // same batch. Only fail (and only count attempts) for this test's own
  // event id - anything else resolves successfully so it never pollutes
  // this test's attempt count or another suite's rows.
  let attempts = 0;
  for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
    // Force availability immediately so the test does not wait out real backoff delays.
    await executeRaw(prisma, `UPDATE "DomainEventOutbox" SET "availableAt" = now() WHERE id = ? AND status = 'PENDING'`, id);
    const result = await drainOutboxOnce(async (event) => {
      if (BigInt(event.id) !== id) return;
      attempts += 1;
      throw new Error('handler always fails');
    });
    if (result.poisoned > 0) break;
  }
  assert.equal(attempts, MAX_DELIVERY_ATTEMPTS, 'the handler must be retried exactly MAX_DELIVERY_ATTEMPTS times before poisoning');

  const [row] = await prisma.$queryRawUnsafe<Array<{ status: string; lastError: string | null }>>(
    `SELECT status, "lastError" FROM "DomainEventOutbox" WHERE id = $1`, id,
  );
  assert.equal(row.status, 'POISON');
  assert.match(row.lastError ?? '', /handler always fails/);

  const poisoned = await listPoisonEvents();
  assert.ok(poisoned.some((p) => p.id === id), 'a poison event must be visible via listPoisonEvents, not silently dropped');

  await requeuePoisonEvent(id);
  const [requeued] = await prisma.$queryRawUnsafe<Array<{ status: string; attempts: number }>>(
    `SELECT status, attempts FROM "DomainEventOutbox" WHERE id = $1`, id,
  );
  assert.equal(requeued.status, 'PENDING');
  assert.equal(requeued.attempts, 0);
});

integration('one poison event does not block delivery of other pending events in the same batch', async () => {
  const poisonId = await insertPendingEvent();
  const goodId = await insertPendingEvent();
  const delivered: bigint[] = [];
  for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
    await executeRaw(prisma, `UPDATE "DomainEventOutbox" SET "availableAt" = now() WHERE id = ? AND status = 'PENDING'`, poisonId);
    await drainOutboxOnce(async (event) => {
      if (BigInt(event.id) === poisonId) throw new Error('always fails');
      delivered.push(BigInt(event.id));
    });
  }
  assert.ok(delivered.includes(goodId), 'the healthy event must still be delivered despite the poison event failing repeatedly');
  const [poisonRow] = await prisma.$queryRawUnsafe<Array<{ status: string }>>(`SELECT status FROM "DomainEventOutbox" WHERE id = $1`, poisonId);
  assert.equal(poisonRow.status, 'POISON');
});
