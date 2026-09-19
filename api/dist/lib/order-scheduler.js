"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderSweepTick = orderSweepTick;
exports.startOrderScheduler = startOrderScheduler;
const tenant_scope_js_1 = require("./saas/tenant-scope.js");
const event_bus_js_1 = require("./event-bus.js");
const orders_js_1 = require("./orders.js");
// Blueprint v4 §23: "Reservation expiry/backorder retry should be automatic
// and visible." Until now both ran only when somebody listed orders, so an
// abandoned reservation kept holding stock (and a backorder kept waiting for
// stock that had already arrived) until the next screen refresh. This sweeps
// on a timer and tells connected clients when something changed.
const INTERVAL_MS = 2 * 60 * 1000;
let running = false;
const defaults = {
    expire: orders_js_1.expireStaleReservations,
    retry: orders_js_1.retryBackorderedOrders,
    announce: () => {
        (0, event_bus_js_1.publishEvent)({ topic: 'stock.changed', companyId: tenant_scope_js_1.DEFAULT_COMPANY_ID });
    },
};
/** One pass: expire first (frees stock), then retry backorders against what was freed and what arrived. */
async function orderSweepTick(deps = defaults) {
    if (running)
        return null;
    running = true;
    try {
        const expired = await deps.expire();
        const filled = await deps.retry();
        if (expired || filled) {
            console.log(`[orders] sweep expired ${expired} reservation(s), filled ${filled} backorder(s)`);
            deps.announce();
        }
        return { expired, filled };
    }
    catch (error) {
        console.warn('[orders] sweep failed', error instanceof Error ? error.message : error);
        return null;
    }
    finally {
        running = false;
    }
}
function startOrderScheduler() {
    const first = setTimeout(() => void orderSweepTick(), 20_000);
    const timer = setInterval(() => void orderSweepTick(), INTERVAL_MS);
    first.unref();
    timer.unref();
    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}
