"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignSchedulerTick = campaignSchedulerTick;
exports.startCampaignScheduler = startCampaignScheduler;
const campaign_service_js_1 = require("./campaign-service.js");
const INTERVAL_MS = 10 * 60 * 1000;
let running = false;
/** One pass; a pass that overlaps a slower previous one is skipped, never stacked. */
async function campaignSchedulerTick(now = new Date()) {
    if (running)
        return;
    running = true;
    try {
        const results = await (0, campaign_service_js_1.runDueCampaigns)(now);
        const assigned = results.reduce((sum, row) => sum + (row.result?.assigned ?? 0), 0);
        if (assigned)
            console.log(`[campaigns] daily allocation assigned ${assigned} item(s) across ${results.length} campaign(s)`);
    }
    catch (error) {
        console.warn('[campaigns] scheduler pass failed', error instanceof Error ? error.message : error);
    }
    finally {
        running = false;
    }
}
/**
 * Blueprint §12: daily assignment happens without an admin doing anything.
 * Passes are cheap and idempotent per local calendar date, so an interval
 * (plus one shortly after boot) also catches a day missed while the server
 * was down.
 */
function startCampaignScheduler() {
    const first = setTimeout(() => void campaignSchedulerTick(), 15_000);
    const timer = setInterval(() => void campaignSchedulerTick(), INTERVAL_MS);
    first.unref();
    timer.unref();
    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}
