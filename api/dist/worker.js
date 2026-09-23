"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const campaign_scheduler_js_1 = require("./lib/campaign-scheduler.js");
const order_scheduler_js_1 = require("./lib/order-scheduler.js");
const distributed_lock_js_1 = require("./lib/distributed-lock.js");
const import_worker_js_1 = require("./lib/import-worker.js");
async function main() {
    if (process.env.REQUIRE_DATABASE === 'true' && !process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is mandatory for the production worker.');
    }
    await (0, distributed_lock_js_1.withDistributedLock)('boot-sweep', async () => {
        await (0, campaign_scheduler_js_1.campaignSchedulerTick)();
        await (0, order_scheduler_js_1.orderSweepTick)();
        await (0, import_worker_js_1.drainImportCommitsOnce)();
    });
    (0, campaign_scheduler_js_1.startCampaignScheduler)();
    (0, order_scheduler_js_1.startOrderScheduler)();
    // Week 11: the durable import-commit worker. Note: lib/outbox-worker.ts's
    // startOutboxWorker (Week 7) is still never called from any production
    // entrypoint - a pre-existing gap discovered while wiring this one in,
    // out of this week's scope to fix (it needs a real delivery handler
    // decision, not a one-line addition) - see AGENTS.md's Week 11 note.
    (0, import_worker_js_1.startImportWorker)();
    console.log('Invexa durable worker is running.');
}
void main().catch((error) => {
    console.error('Worker failed to start', error);
    process.exitCode = 1;
});
