import './lib/telemetry-bootstrap.js';
import { startCampaignScheduler, campaignSchedulerTick } from './lib/campaign-scheduler.js';
import { startOrderScheduler, orderSweepTick } from './lib/order-scheduler.js';
import { withDistributedLock } from './lib/distributed-lock.js';
import { startImportWorker, drainImportCommitsOnce } from './lib/import-worker.js';
import { startOutboxRetention, pruneOutboxOnce } from './lib/outbox-retention.js';
import { startExpirySweep } from './lib/expiry-sweep.js';
import { drainOutboxOnce, startOutboxWorker } from './lib/outbox-worker.js';
import { deliverPersistedEvent } from './lib/event-bus.js';

async function main() {
  if (process.env.REQUIRE_DATABASE === 'true' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is mandatory for the production worker.');
  }
  await withDistributedLock('boot-sweep', async () => {
    await campaignSchedulerTick();
    await orderSweepTick();
    await drainImportCommitsOnce();
    await drainOutboxOnce(deliverPersistedEvent);
    await pruneOutboxOnce();
  });
  startCampaignScheduler();
  startOrderScheduler();
  // Week 11: the durable import-commit worker.
  startImportWorker();
  // lib/outbox-worker.ts's startOutboxWorker (Week 7) is now wired to
  // lib/event-bus.ts's deliverPersistedEvent - a live consumer that
  // broadcasts each delivered event to connected SSE subscribers,
  // superseding this repo's own Week 14 conclusion (see
  // docs/week14-outbox-retention.md) that no real consumer existed at the
  // time. The retention sweep below stays alongside it: it prunes rows
  // past OUTBOX_RETENTION_DAYS regardless of delivery outcome (including
  // any that end up POISON), so the table still cannot grow unbounded
  // even with a live consumer now attached.
  startOutboxWorker(deliverPersistedEvent);
  startOutboxRetention();
  startExpirySweep();
  console.log('Invexa durable worker is running.');
}

void main().catch((error) => {
  console.error('Worker failed to start', error);
  process.exitCode = 1;
});
