"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const campaign_scheduler_js_1 = require("./lib/campaign-scheduler.js");
const order_scheduler_js_1 = require("./lib/order-scheduler.js");
const distributed_lock_js_1 = require("./lib/distributed-lock.js");
const import_worker_js_1 = require("./lib/import-worker.js");
const outbox_retention_js_1 = require("./lib/outbox-retention.js");
const outbox_worker_js_1 = require("./lib/outbox-worker.js");
const event_bus_js_1 = require("./lib/event-bus.js");
async function main() {
    if (process.env.REQUIRE_DATABASE === 'true' && !process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is mandatory for the production worker.');
    }
    await (0, distributed_lock_js_1.withDistributedLock)('boot-sweep', async () => {
        await (0, campaign_scheduler_js_1.campaignSchedulerTick)();
        await (0, order_scheduler_js_1.orderSweepTick)();
        await (0, import_worker_js_1.drainImportCommitsOnce)();
        await (0, outbox_worker_js_1.drainOutboxOnce)(event_bus_js_1.deliverPersistedEvent);
        await (0, outbox_retention_js_1.pruneOutboxOnce)();
    });
    (0, campaign_scheduler_js_1.startCampaignScheduler)();
    (0, order_scheduler_js_1.startOrderScheduler)();
    // Week 11: the durable import-commit worker.
    (0, import_worker_js_1.startImportWorker)();
    // lib/outbox-worker.ts's startOutboxWorker (Week 7) is now wired to
    // lib/event-bus.ts's deliverPersistedEvent - a live consumer that
    // broadcasts each delivered event to connected SSE subscribers,
    // superseding this repo's own Week 14 conclusion (see
    // docs/week14-outbox-retention.md) that no real consumer existed at the
    // time. The retention sweep below stays alongside it: it prunes rows
    // past OUTBOX_RETENTION_DAYS regardless of delivery outcome (including
    // any that end up POISON), so the table still cannot grow unbounded
    // even with a live consumer now attached.
    (0, outbox_worker_js_1.startOutboxWorker)(event_bus_js_1.deliverPersistedEvent);
    (0, outbox_retention_js_1.startOutboxRetention)();
    console.log('Invexa durable worker is running.');
}
void main().catch((error) => {
    console.error('Worker failed to start', error);
    process.exitCode = 1;
});
