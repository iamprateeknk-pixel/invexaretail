// The alert sweep against real Postgres: a POISON outbox row, a mismatching reconciliation run and a
// stuck mutation receipt each become an alert, and fixing them resolves the alert. Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { resetAlertSweepForTests, runAlertSweepOnce, type AlertTransport } from './alerting.js';
import { STALE_IN_PROGRESS_MS } from './mutation-idempotency.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration('the sweep reports real breaches from the database once, then reports them resolved', async () => {
  resetAlertSweepForTests();
  const sent: Array<Parameters<AlertTransport>[0]> = [];
  const transport: AlertTransport = async (payload) => { sent.push(payload); };
  const companyId = `alert-co-${randomUUID()}`;
  const poison = await prisma.domainEventOutbox.create({ data: { topic: 'stock.changed', companyId, status: 'POISON', occurredAt: new Date() } });
  const run = await prisma.reconciliationRun.create({
    data: { companyId, trigger: 'manual', startedAt: new Date(Date.now() + 60_000), finishedAt: new Date(Date.now() + 60_000), ledgerRows: 10, explained: 8, mismatches: 2, noJournalHistory: 0, mismatchAbsDelta: 5, maxAbsDelta: 3, sampleJson: '[]' },
  });
  const old = new Date(Date.now() - STALE_IN_PROGRESS_MS - 60_000);
  const receipt = await prisma.mutationReceipt.create({ data: { companyId, userId: 'u', mutationId: `alert-${randomUUID()}`, fingerprint: 'f', state: 'IN_PROGRESS', createdAt: old, updatedAt: old } });
  try {
    const first = await runAlertSweepOnce(transport);
    assert.ok(first && first.sent >= 3, 'poison, stock mismatch and stuck receipts fire');
    const keys = sent[0].alerts.map((alert) => alert.key);
    assert.ok(keys.includes('outbox-poison'));
    assert.ok(keys.includes(`stock-mismatch:${companyId}`));
    assert.ok(keys.includes('sync-stuck'));

    const again = await runAlertSweepOnce(transport);
    assert.equal(again?.sent, 0, 'a standing breach is not re-sent on the next sweep');

    await prisma.domainEventOutbox.delete({ where: { id: poison.id } });
    await prisma.reconciliationRun.delete({ where: { id: run.id } });
    await prisma.mutationReceipt.delete({ where: { id: receipt.id } });
    const cleared = await runAlertSweepOnce(transport);
    assert.ok(cleared && cleared.resolved >= 1, 'fixing the causes resolves the alerts');
    assert.ok(sent.at(-1)!.text.includes('[RESOLVED]'));
  } finally {
    await prisma.domainEventOutbox.deleteMany({ where: { companyId } });
    await prisma.reconciliationRun.deleteMany({ where: { companyId } });
    await prisma.mutationReceipt.deleteMany({ where: { companyId } });
    resetAlertSweepForTests();
  }
});
