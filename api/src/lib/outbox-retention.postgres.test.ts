// Week 14: DomainEventOutbox retention pruning, exercised against real
// Postgres. Skipped unless TEST_DATABASE_URL is set (see AGENTS.md
// "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { pruneDomainEventOutbox, OUTBOX_RETENTION_DAYS, durableEventsSince } from './event-bus.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

integration('prunes rows older than the retention window and leaves recent rows untouched', async () => {
  const companyId = `outbox-retention-test-${randomUUID()}`;
  await prisma.domainEventOutbox.create({
    data: { topic: 'stock.changed', companyId, occurredAt: daysAgo(OUTBOX_RETENTION_DAYS + 1) },
  });
  const recent = await prisma.domainEventOutbox.create({
    data: { topic: 'stock.changed', companyId, occurredAt: daysAgo(1) },
  });

  const removed = await pruneDomainEventOutbox();
  assert.ok(removed >= 1);

  const remaining = await prisma.domainEventOutbox.findMany({ where: { companyId } });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, recent.id);
});

integration('a client reconnecting within the retention window can still replay through durableEventsSince', async () => {
  const companyId = `outbox-retention-test-${randomUUID()}`;
  const before = await prisma.domainEventOutbox.create({
    data: { topic: 'stock.changed', companyId, occurredAt: daysAgo(1) },
  });
  const after = await prisma.domainEventOutbox.create({
    data: { topic: 'item.changed', companyId, occurredAt: daysAgo(0.5) },
  });

  await pruneDomainEventOutbox();

  const events = await durableEventsSince(Number(before.id) - 1, { companyId, locationIds: null });
  const ids = events.map((e) => e.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [Number(before.id), Number(after.id)]);
});
