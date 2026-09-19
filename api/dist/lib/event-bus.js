"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_EPOCH = exports.EVENT_TOPICS = void 0;
exports.canReceive = canReceive;
exports.publishEvent = publishEvent;
exports.subscribe = subscribe;
exports.subscriberCount = subscriberCount;
exports.latestEventId = latestEventId;
exports.eventsSince = eventsSince;
exports.resetEventBusForTests = resetEventBusForTests;
const node_crypto_1 = require("node:crypto");
// Blueprint v4 §11 / Appendix B: successful mutations publish a domain event;
// authorized web/mobile sessions receive it over an authenticated SSE stream
// and refetch only what changed instead of relying on manual refresh.
exports.EVENT_TOPICS = [
    'stock.changed',
    'item.changed',
    'lot.changed',
    'count.changed',
    'assignment.changed',
    'campaign.changed',
    'transfer.changed',
    'pick.changed',
    'receipt.changed',
    'putaway.changed',
    'import.committed',
    'exception.changed',
    'approval.changed',
    'permission.changed',
    'config.changed',
    'connector.changed',
];
const BUFFER_MAX = 1000;
// Changes on every process start, so a client holding a cursor from before a
// restart knows the numeric ids no longer line up and must do a full resync.
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
function publishEvent(input) {
    const event = { ...input, id: ++sequence, at: new Date().toISOString() };
    buffer.push(event);
    if (buffer.length > BUFFER_MAX)
        buffer.splice(0, buffer.length - BUFFER_MAX);
    for (const subscriber of subscribers.values()) {
        if (!canReceive(subscriber, event))
            continue;
        try {
            subscriber.send(event);
        }
        catch {
            // A dead socket must never break the request that produced the event.
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
function subscriberCount() {
    return subscribers.size;
}
function latestEventId() {
    return sequence;
}
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
function resetEventBusForTests() {
    sequence = 0;
    buffer.length = 0;
    subscribers.clear();
}
