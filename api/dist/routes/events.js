"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishMutationEvents = publishMutationEvents;
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const event_bus_js_1 = require("../lib/event-bus.js");
const event_topics_js_1 = require("../lib/event-topics.js");
const persistence_js_1 = require("../lib/persistence.js");
const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_USER = 5;
const MAX_STREAMS_TOTAL = 2000;
const streamsByUser = new Map();
function visibleLocationIds(user) { return user.role === 'ADMIN' || user.role === 'ADMIN_USER' ? null : user.locationIds ?? []; }
function frame(event) { const { id, topic, ...data } = event; return `id: ${id}\nevent: ${topic}\ndata: ${JSON.stringify({ id, topic, ...data })}\n\n`; }
function publishMutationEvents(req, res, next) {
    const topics = (0, event_topics_js_1.topicsForMutation)(req.method, req.path);
    if (!topics.length)
        return next();
    res.on('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300 || !req.companyId)
            return;
        const locationIds = (0, event_topics_js_1.locationIdsForMutation)(req.path, req.body);
        for (const topic of topics)
            (0, event_bus_js_1.publishEvent)({ topic, companyId: req.companyId, ...(locationIds ? { locationIds } : {}), actorId: req.userId ?? req.user?.id, requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined });
    });
    next();
}
const router = (0, express_1.Router)();
router.get('/events', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, async (req, res) => {
    const user = req.user;
    const companyId = req.companyId ?? user.companyId;
    if ((0, event_bus_js_1.subscriberCount)() >= MAX_STREAMS_TOTAL)
        return res.status(503).json({ message: 'Live updates are at capacity. Retry shortly.' });
    if ((streamsByUser.get(user.id) ?? 0) >= MAX_STREAMS_PER_USER)
        return res.status(429).json({ message: 'Too many live connections for this user.' });
    streamsByUser.set(user.id, (streamsByUser.get(user.id) ?? 0) + 1);
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const locationIds = visibleLocationIds(user);
    const write = (chunk) => { res.write(chunk); };
    const durable = persistence_js_1.databaseEnabled;
    let cursor = 0;
    write('retry: 3000\n\n');
    write(`event: hello\ndata: ${JSON.stringify({ epoch: event_bus_js_1.SERVER_EPOCH, latestEventId: durable ? await (0, event_bus_js_1.durableLatestEventId)() : (0, event_bus_js_1.latestEventId)(), serverTime: new Date().toISOString() })}\n\n`);
    const lastHeader = req.header('last-event-id') ?? (typeof req.query.cursor === 'string' ? req.query.cursor : '');
    const clientEpoch = typeof req.query.epoch === 'string' ? req.query.epoch : undefined;
    if (lastHeader !== '' && Number.isFinite(Number(lastHeader))) {
        cursor = Number(lastHeader);
        if (durable) {
            const rows = await (0, event_bus_js_1.durableEventsSince)(cursor, { companyId, locationIds });
            rows.forEach((event) => { cursor = event.id; write(frame(event)); });
        }
        else {
            const replay = (0, event_bus_js_1.eventsSince)(cursor, { companyId, locationIds }, clientEpoch);
            if (replay.kind === 'reset')
                write(`event: reset\ndata: ${JSON.stringify({ epoch: event_bus_js_1.SERVER_EPOCH, latestEventId: (0, event_bus_js_1.latestEventId)() })}\n\n`);
            else
                replay.events.forEach((event) => { cursor = event.id; write(frame(event)); });
        }
    }
    const subscription = durable ? undefined : (0, event_bus_js_1.subscribe)({ companyId, userId: user.id, locationIds, send: (event) => write(frame(event)) });
    let polling = false;
    const durablePoll = durable ? setInterval(() => void (async () => {
        if (polling)
            return;
        polling = true;
        try {
            const rows = await (0, event_bus_js_1.durableEventsSince)(cursor, { companyId, locationIds });
            rows.forEach((event) => { cursor = event.id; write(frame(event)); });
        }
        catch (error) {
            console.error('[events] durable poll failed', error);
        }
        finally {
            polling = false;
        }
    })(), 1000) : undefined;
    const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
    let closed = false;
    const cleanup = () => { if (closed)
        return; closed = true; clearInterval(heartbeat); if (durablePoll)
        clearInterval(durablePoll); subscription?.unsubscribe(); const remaining = (streamsByUser.get(user.id) ?? 1) - 1; if (remaining <= 0)
        streamsByUser.delete(user.id);
    else
        streamsByUser.set(user.id, remaining); };
    res.on('close', cleanup);
    res.on('error', cleanup);
});
exports.default = router;
