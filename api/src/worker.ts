import { startCampaignScheduler, campaignSchedulerTick } from './lib/campaign-scheduler.js';
import { startOrderScheduler, orderSweepTick } from './lib/order-scheduler.js';
import { withDistributedLock } from './lib/distributed-lock.js';

async function main() {
  if (process.env.REQUIRE_DATABASE === 'true' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is mandatory for the production worker.');
  }
  await withDistributedLock('boot-sweep', async () => {
    await campaignSchedulerTick();
    await orderSweepTick();
  });
  startCampaignScheduler();
  startOrderScheduler();
  console.log('Invexa durable worker is running.');
}

void main().catch((error) => {
  console.error('Worker failed to start', error);
  process.exitCode = 1;
});