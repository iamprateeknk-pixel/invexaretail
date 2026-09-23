"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pruneOutboxOnce = pruneOutboxOnce;
exports.startOutboxRetention = startOutboxRetention;
exports.stopOutboxRetention = stopOutboxRetention;
// Week 14: the background sweep that actually fixes the DomainEventOutbox
// unbounded-growth gap (see event-bus.ts's pruneDomainEventOutbox and
// docs/week14-outbox-retention.md). Same poll-loop shape as Week 11's
// lib/import-worker.ts.
const event_bus_js_1 = require("./event-bus.js");
let pollTimer = null;
async function pruneOutboxOnce() {
    return (0, event_bus_js_1.pruneDomainEventOutbox)();
}
/** Starts a background poll loop. Once a day is plenty for a retention sweep - call `stopOutboxRetention()` to stop it (used in tests and graceful shutdown). */
function startOutboxRetention(intervalMs = 24 * 60 * 60 * 1000) {
    if (pollTimer)
        return;
    pollTimer = setInterval(() => {
        pruneOutboxOnce().catch((error) => console.error('[outbox-retention] prune failed', error));
    }, intervalMs);
    pollTimer.unref?.();
}
function stopOutboxRetention() {
    if (pollTimer)
        clearInterval(pollTimer);
    pollTimer = null;
}
