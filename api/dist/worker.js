"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const campaign_scheduler_js_1 = require("./lib/campaign-scheduler.js");
const order_scheduler_js_1 = require("./lib/order-scheduler.js");
const distributed_lock_js_1 = require("./lib/distributed-lock.js");
const import_worker_js_1 = require("./lib/import-worker.js");
const outbox_retention_js_1 = require("./lib/outbox-retention.js");
async function main() {
    if (process.env.REQUIRE_DATABASE === 'true' && !process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is mandatory for the production worker.');
    }
    await (0, distributed_lock_js_1.withDistributedLock)('boot-sweep', async () => {
        await (0, campaign_scheduler_js_1.campaignSchedulerTick)();
        await (0, order_scheduler_js_1.orderSweepTick)();
        await (0, import_worker_js_1.drainImportCommitsOnce)();
        await (0, outbox_retention_js_1.pruneOutboxOnce)();
    });
    (0, campaign_scheduler_js_1.startCampaignScheduler)();
    (0, order_scheduler_js_1.startOrderScheduler)();
    // Week 11: the durable import-commit worker.
    (0, import_worker_js_1.startImportWorker)();
    // Week 14: retention sweep for DomainEventOutbox (see
    // lib/outbox-retention.ts and docs/week14-outbox-retention.md). Note:
    // lib/outbox-worker.ts's startOutboxWorker (Week 7) is deliberately still
    // not called here - investigated this week and found there is no real
    // consumer to wire its delivery semantics to (SSE reads this table
    // directly via durableEventsSince, independent of delivery status; the
    // separate webhook system carries entity payloads this bare table
    // doesn't have). The actual bug - the table growing forever with nothing
    // ever pruning it - is what this week's retention sweep fixes instead.
    (0, outbox_retention_js_1.startOutboxRetention)();
    console.log('Invexa durable worker is running.');
}
void main().catch((error) => {
    console.error('Worker failed to start', error);
    process.exitCode = 1;
});
