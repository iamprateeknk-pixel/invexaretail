import { startCampaignScheduler, campaignSchedulerTick } from './lib/campaign-scheduler.js';
import { startOrderScheduler, orderSweepTick } from './lib/order-scheduler.js';
import { withDistributedLock } from './lib/distributed-lock.js';
import { startImportWorker, drainImportCommitsOnce } from './lib/import-worker.js';

async function main() {
  if (process.env.REQUIRE_DATABASE === 'true' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is mandatory for the production worker.');
  }
  await withDistributedLock('boot-sweep', async () => {
    await campaignSchedulerTick();
    await orderSweepTick();
    await drainImportCommitsOnce();
  });
  startCampaignScheduler();
  startOrderScheduler();
  // Week 11: the durable import-commit worker. Note: lib/outbox-worker.ts's
  // startOutboxWorker (Week 7) is still never called from any production
  // entrypoint - a pre-existing gap discovered while wiring this one in,
  // out of this week's scope to fix (it needs a real delivery handler
  // decision, not a one-line addition) - see AGENTS.md's Week 11 note.
  startImportWorker();
  console.log('Invexa durable worker is running.');
}

void main().catch((error) => {
  console.error('Worker failed to start', error);
  process.exitCode = 1;
});