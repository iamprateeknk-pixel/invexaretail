"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const campaign_scheduler_js_1 = require("./lib/campaign-scheduler.js");
const order_scheduler_js_1 = require("./lib/order-scheduler.js");
const distributed_lock_js_1 = require("./lib/distributed-lock.js");
async function main() {
    if (process.env.REQUIRE_DATABASE === 'true' && !process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is mandatory for the production worker.');
    }
    await (0, distributed_lock_js_1.withDistributedLock)('boot-sweep', async () => {
        await (0, campaign_scheduler_js_1.campaignSchedulerTick)();
        await (0, order_scheduler_js_1.orderSweepTick)();
    });
    (0, campaign_scheduler_js_1.startCampaignScheduler)();
    (0, order_scheduler_js_1.startOrderScheduler)();
    console.log('Invexa durable worker is running.');
}
void main().catch((error) => {
    console.error('Worker failed to start', error);
    process.exitCode = 1;
});
