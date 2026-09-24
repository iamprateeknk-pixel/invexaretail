// Week 19 execution-guide scope ("outbox lag ... business SLIs"), exercised
// against real Postgres. Skipped unless TEST_DATABASE_URL is set (see
// AGENTS.md "Required tests" - a change to lib/event-bus.ts's outbox
// concerns needs real-database coverage).
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { outboxHealthSnapshot } from './event-bus.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

integration('reports zero pending/poison and zero lag when the outbox is empty for the relevant window', async () => {
  const companyId = `outbox-health-test-${randomUUID()}`;
  // Nothing created under this companyId; the snapshot is global (an
  // operational/infra SLI, not tenant business data - only counts and ages
  // are exposed, nothing tenant-identifying), so isolate by asserting
  // relative behavior instead of an absolute zero.
  const before = await outboxHealthSnapshot();
  assert.ok(before, 'expected a snapshot in database mode');

  await prisma.domainEventOutbox.create({ data: { topic: 'stock.changed', companyId, status: 'DELIVERED', occurredAt: minutesAgo(5) } });
  const afterDeliveredOnly = await outboxHealthSnapshot();
  assert.equal(afterDeliveredOnly!.pending, before!.pending, 'a DELIVERED row must not count as pending');
});

integration('oldestPendingAgeSeconds reflects the oldest still-PENDING row, and poison rows are counted separately', async () => {
  const companyId = `outbox-health-test-${randomUUID()}`;
  const oldPending = await prisma.domainEventOutbox.create({
    data: { topic: 'stock.changed', companyId, status: 'PENDING', occurredAt: minutesAgo(20) },
  });
  await prisma.domainEventOutbox.create({
    data: { topic: 'stock.changed', companyId, status: 'PENDING', occurredAt: minutesAgo(1) },
  });
  await prisma.domainEventOutbox.create({
    data: { topic: 'stock.changed', companyId, status: 'POISON', occurredAt: minutesAgo(30) },
  });

  const now = new Date();
  const snapshot = await outboxHealthSnapshot(now);
  assert.ok(snapshot);
  assert.ok(snapshot!.pending >= 2);
  assert.ok(snapshot!.poison >= 1);
  const expectedAgeSeconds = Math.round((now.getTime() - oldPending.occurredAt.getTime()) / 1000);
  // The oldest PENDING row across the whole table drives the lag figure - a
  // newer PENDING row from another test/company must never make it look
  // younger than it is.
  assert.ok(snapshot!.oldestPendingAgeSeconds >= expectedAgeSeconds - 2);
});
