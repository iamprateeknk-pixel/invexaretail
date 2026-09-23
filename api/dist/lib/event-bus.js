"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_EPOCH = exports.EVENT_TOPICS = void 0;
exports.canReceive = canReceive;
exports.publishEvent = publishEvent;
exports.subscribe = subscribe;
exports.subscriberCount = subscriberCount;
exports.latestEventId = latestEventId;
exports.eventsSince = eventsSince;
exports.durableEventsSince = durableEventsSince;
exports.durableLatestEventId = durableLatestEventId;
exports.resetEventBusForTests = resetEventBusForTests;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const persistence_js_1 = require("./persistence.js");
const db_js_1 = require("./db.js");
exports.EVENT_TOPICS = ['stock.changed', 'item.changed', 'lot.changed', 'count.changed', 'assignment.changed', 'campaign.changed', 'transfer.changed', 'pick.changed', 'receipt.changed', 'putaway.changed', 'import.committed', 'exception.changed', 'approval.changed', 'permission.changed', 'config.changed', 'connector.changed'];
const BUFFER_MAX = 1000;
exports.SERVER_EPOCH = (0, node_crypto_1.randomUUID)();
let sequence = 0;
const buffer = [];
const subscribers = new Map();
function canReceive(subscriber, event) {
    if (subscriber.companyId !== event.companyId)
        return false;
    if (!event.locationIds?.length || subscriber.locationIds === null)
        return true;
    return event.locationIds.some((locationId) => subscriber.locationIds.includes(locationId));
}
async function persistEvent(event) {
    if (!persistence_js_1.databaseEnabled)
        return;
    await db_js_1.prisma.domainEventOutbox.create({
        data: {
            topic: event.topic,
            companyId: event.companyId,
            locationIds: event.locationIds?.length ? event.locationIds : client_1.Prisma.JsonNull,
            actorId: event.actorId ?? null,
            requestId: event.requestId ?? null,
            occurredAt: new Date(event.at),
        },
    });
}
/** Local delivery is for memory mode. Database mode readers poll the durable outbox, including events from other replicas. */
function publishEvent(input) {
    const event = { ...input, id: ++sequence, at: new Date().toISOString() };
    buffer.push(event);
    if (buffer.length > BUFFER_MAX)
        buffer.splice(0, buffer.length - BUFFER_MAX);
    if (persistence_js_1.databaseEnabled) {
        void persistEvent(event).catch((error) => console.error('[events] durable outbox write failed', error));
        return event;
    }
    for (const subscriber of subscribers.values()) {
        if (!canReceive(subscriber, event))
            continue;
        try {
            subscriber.send(event);
        }
        catch {
            subscribers.delete(subscriber.id);
        }
    }
    return event;
}
function subscribe(subscriber) {
    const id = (0, node_crypto_1.randomUUID)();
    subscribers.set(id, { ...subscriber, id });
    return { id, unsubscribe: () => { subscribers.delete(id); } };
}
function subscriberCount() { return subscribers.size; }
function latestEventId() { return sequence; }
function eventsSince(lastEventId, subscriber, clientEpoch) {
    if (clientEpoch && clientEpoch !== exports.SERVER_EPOCH)
        return { kind: 'reset' };
    if (lastEventId > sequence)
        return { kind: 'reset' };
    const oldest = buffer[0]?.id ?? sequence + 1;
    if (lastEventId + 1 < oldest && lastEventId < sequence)
        return { kind: 'reset' };
    return { kind: 'replay', events: buffer.filter((event) => event.id > lastEventId && canReceive(subscriber, event)) };
}
function locations(value) {
    if (Array.isArray(value))
        return value.filter((id) => typeof id === 'string');
    if (typeof value !== 'string')
        return undefined;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : undefined;
    }
    catch {
        return undefined;
    }
}
async function durableEventsSince(lastEventId, subscriber) {
    if (!persistence_js_1.databaseEnabled)
        return eventsSince(lastEventId, subscriber).kind === 'replay' ? eventsSince(lastEventId, subscriber).events : [];
    const rows = await db_js_1.prisma.domainEventOutbox.findMany({
        where: { id: { gt: BigInt(lastEventId) }, companyId: subscriber.companyId },
        orderBy: { id: 'asc' },
        take: 500,
    });
    return rows.map((row) => ({ id: Number(row.id), topic: row.topic, companyId: row.companyId, ...(locations(row.locationIds)?.length ? { locationIds: locations(row.locationIds) } : {}), ...(row.actorId ? { actorId: row.actorId } : {}), ...(row.requestId ? { requestId: row.requestId } : {}), at: new Date(row.occurredAt).toISOString() })).filter((event) => canReceive(subscriber, event));
}
async function durableLatestEventId() {
    if (!persistence_js_1.databaseEnabled)
        return latestEventId();
    const result = await db_js_1.prisma.domainEventOutbox.aggregate({ _max: { id: true } });
    return Number(result._max.id ?? 0);
}
function resetEventBusForTests() { sequence = 0; buffer.length = 0; subscribers.clear(); }
