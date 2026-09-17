"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetWebhookStore = resetWebhookStore;
exports.toPublicSubscription = toPublicSubscription;
exports.listWebhookSubscriptions = listWebhookSubscriptions;
exports.listMatchingSubscriptions = listMatchingSubscriptions;
exports.getWebhookSubscription = getWebhookSubscription;
exports.createWebhookSubscription = createWebhookSubscription;
exports.setWebhookSubscriptionStatus = setWebhookSubscriptionStatus;
exports.listWebhookDeliveries = listWebhookDeliveries;
exports.recordWebhookDelivery = recordWebhookDelivery;
exports.getWebhookDelivery = getWebhookDelivery;
exports.updateWebhookDelivery = updateWebhookDelivery;
exports.listDueRetries = listDueRetries;
const node_crypto_1 = require("node:crypto");
const webhook_events_js_1 = require("./webhook-events.js");
const subscriptions = [];
const deliveries = [];
function resetWebhookStore() {
    subscriptions.splice(0, subscriptions.length);
    deliveries.splice(0, deliveries.length);
}
function toPublicSubscription(record) {
    return {
        id: record.id,
        name: record.name,
        endpointUrl: record.endpointUrl,
        events: [...record.events],
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}
function listWebhookSubscriptions() {
    return [...subscriptions]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toPublicSubscription);
}
function listMatchingSubscriptions(eventType) {
    return subscriptions.filter((subscription) => subscription.status === 'ACTIVE' && subscription.events.includes(eventType));
}
function getWebhookSubscription(id) {
    return subscriptions.find((subscription) => subscription.id === id);
}
function createWebhookSubscription(input) {
    const name = (0, webhook_events_js_1.parseWebhookName)(input.name);
    const events = (0, webhook_events_js_1.parseWebhookEvents)(input.events);
    const endpoint = (0, webhook_events_js_1.parseWebhookEndpoint)(input.endpointUrl, { allowPrivate: input.allowPrivate });
    const now = new Date().toISOString();
    const signingSecret = input.signingSecret ?? (0, node_crypto_1.randomBytes)(32).toString('hex');
    const record = {
        id: input.id ?? `hook-${(0, node_crypto_1.randomBytes)(6).toString('hex')}`,
        name,
        endpointUrl: endpoint.toString(),
        events,
        secretHash: (0, webhook_events_js_1.hashWebhookSecret)(signingSecret),
        signingSecret,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
    };
    subscriptions.unshift(record);
    return { subscription: toPublicSubscription(record), signingSecret };
}
function setWebhookSubscriptionStatus(id, status) {
    if (status !== 'ACTIVE' && status !== 'PAUSED') {
        throw new Error('Status must be ACTIVE or PAUSED.');
    }
    const record = subscriptions.find((subscription) => subscription.id === id);
    if (!record)
        throw new Error('Webhook subscription was not found.');
    record.status = status;
    record.updatedAt = new Date().toISOString();
    return toPublicSubscription(record);
}
function listWebhookDeliveries(limit = 100) {
    return deliveries.slice(0, limit).map((row) => ({ ...row }));
}
function recordWebhookDelivery(input) {
    const record = {
        id: input.id ?? `whdel-${(0, node_crypto_1.randomBytes)(6).toString('hex')}`,
        subscriptionId: input.subscriptionId,
        eventType: input.eventType,
        entityId: input.entityId,
        status: input.status,
        attemptCount: input.attemptCount,
        responseCode: input.responseCode,
        lastError: input.lastError,
        createdAt: input.createdAt ?? new Date().toISOString(),
        deliveredAt: input.deliveredAt,
        payloadHash: input.payloadHash,
        nextRetryAt: input.nextRetryAt,
        body: input.body,
    };
    deliveries.unshift(record);
    return record;
}
function getWebhookDelivery(id) {
    const record = deliveries.find((row) => row.id === id);
    return record ? { ...record } : undefined;
}
function updateWebhookDelivery(id, patch) {
    const record = deliveries.find((row) => row.id === id);
    if (!record)
        return undefined;
    Object.assign(record, patch);
    return { ...record };
}
function listDueRetries(now = new Date().toISOString()) {
    return deliveries.filter((row) => row.status === 'FAILED' && row.nextRetryAt && row.nextRetryAt <= now).map((row) => ({ ...row }));
}
