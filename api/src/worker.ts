import { startCampaignScheduler, campaignSchedulerTick } from './lib/campaign-scheduler.js';
import { startOrderScheduler, orderSweepTick } from './lib/order-scheduler.js';
import { withDistributedLock } from './lib/distributed-lock.js';
import { startImportWorker, drainImportCommitsOnce } from './lib/import-worker.js';
import { startOutboxRetention, pruneOutboxOnce } from './lib/outbox-retention.js';

async function main() {
  if (process.env.REQUIRE_DATABASE === 'true' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is mandatory for the production worker.');
  }
  await withDistributedLock('boot-sweep', async () => {
    await campaignSchedulerTick();
    await orderSweepTick();
    await drainImportCommitsOnce();
    await pruneOutboxOnce();
  });
  startCampaignScheduler();
  startOrderScheduler();
  // Week 11: the durable import-commit worker.
  startImportWorker();
  // Week 14: retention sweep for DomainEventOutbox (see
  // lib/outbox-retention.ts and docs/week14-outbox-retention.md). Note:
  // lib/outbox-worker.ts's startOutboxWorker (Week 7) is deliberately still
  // not called here - investigated this week and found there is no real
  // consumer to wire its delivery semantics to (SSE reads this table
  // directly via durableEventsSince, independent of delivery status; the
  // separate webhook system carries entity payloads this bare table
  // doesn't have). The actual bug - the table growing forever with nothing
  // ever pruning it - is what this week's retention sweep fixes instead.
  startOutboxRetention();
  console.log('Invexa durable worker is running.');
}

void main().catch((error) => {
  console.error('Worker failed to start', error);
  process.exitCode = 1;
});