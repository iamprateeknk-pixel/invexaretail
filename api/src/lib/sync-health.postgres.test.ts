// Real Postgres: sync health counts only the caller's company, treats an old IN_PROGRESS receipt
// as stuck, and never mixes in another company's work. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { getSyncHealth } from './sync-health.js';
import { STALE_IN_PROGRESS_MS } from './mutation-idempotency.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration('sync health: stuck work is surfaced per company and never leaks across companies', async () => {
  const a = `co-a-${randomUUID()}`;
  const b = `co-b-${randomUUID()}`;
  const now = new Date();
  const old = new Date(now.getTime() - STALE_IN_PROGRESS_MS - 60_000);
  const row = (companyId: string, mutationId: string, state: string, updatedAt = now) => ({
    companyId, userId: 'u-1', mutationId, fingerprint: 'f', state, statusCode: state === 'COMPLETED' ? 201 : null, createdAt: updatedAt, updatedAt,
  });
  try {
    await prisma.mutationReceipt.createMany({ data: [
      row(a, 'mutation-a-done', 'COMPLETED'),
      row(a, 'mutation-a-fresh', 'IN_PROGRESS'),
      row(a, 'mutation-a-stuck', 'IN_PROGRESS', old),
      row(b, 'mutation-b-stuck-1', 'IN_PROGRESS', old),
      row(b, 'mutation-b-stuck-2', 'IN_PROGRESS', old),
    ] });

    const healthA = await getSyncHealth(a, now);
    assert.equal(healthA.completed, 1);
    assert.equal(healthA.inProgress, 2);
    assert.equal(healthA.stuck, 1, 'only the receipt past the stale window is stuck');
    assert.deepEqual(healthA.stuckSample.map((s) => s.mutationId), ['mutation-a-stuck']);
    assert.ok(healthA.stuckSample[0].ageSeconds >= STALE_IN_PROGRESS_MS / 1000);
    assert.equal(healthA.breached, true);

    const healthB = await getSyncHealth(b, now);
    assert.equal(healthB.stuck, 2);
    assert.ok(healthB.stuckSample.every((s) => s.mutationId.startsWith('mutation-b-')), 'company B sees none of company A\'s work');

    const nobody = await getSyncHealth(`co-none-${randomUUID()}`, now);
    assert.deepEqual([nobody.completed, nobody.inProgress, nobody.stuck, nobody.breached], [0, 0, 0, false]);
  } finally {
    await prisma.mutationReceipt.deleteMany({ where: { companyId: { in: [a, b] } } });
  }
});
