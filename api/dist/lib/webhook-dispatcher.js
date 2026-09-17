"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookReplayError = void 0;
exports.setWebhookTransport = setWebhookTransport;
exports.resetWebhookTransport = resetWebhookTransport;
exports.waitForWebhooks = waitForWebhooks;
exports.buildWebhookEnvelope = buildWebhookEnvelope;
exports.deliverSubscription = deliverSubscription;
exports.persistDelivery = persistDelivery;
exports.replayDelivery = replayDelivery;
exports.retryDueDeliveries = retryDueDeliveries;
exports.dispatchWebhookEvent = dispatchWebhookEvent;
exports.emitWebhookEvent = emitWebhookEvent;
exports.emitTransferUpdated = emitTransferUpdated;
exports.itemOnHand = itemOnHand;
exports.maybeEmitStockLow = maybeEmitStockLow;
const node_crypto_1 = require("node:crypto");
const reorder_store_js_1 = require("./reorder-store.js");
const repository_js_1 = require("./repository.js");
const persistence_js_1 = require("./persistence.js");
const db_js_1 = require("./db.js");
const webhook_events_js_1 = require("./webhook-events.js");
const webhook_store_js_1 = require("./webhook-store.js");
const webhook_bridge_js_1 = require("./webhook-bridge.js");
const webhook_retry_js_1 = require("./webhook-retry.js");
const DEFAULT_TIMEOUT_MS = 8_000;
const defaultTransport = async (url, init) => {
    const response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: init.signal,
    });
    return { status: response.status };
};
let transport = defaultTransport;
const inflight = new Set();
function setWebhookTransport(next) {
    transport = next;
}
function resetWebhookTransport() {
    transport = defaultTransport;
}
async function waitForWebhooks() {
    await Promise.all([...inflight]);
}
function buildWebhookEnvelope(input) {
    const payload = {
        id: input.deliveryId,
        event: input.type,
        createdAt: input.createdAt,
        data: input.data,
    };
    return { payload, body: JSON.stringify(payload) };
}
async function deliverSubscription(subscription, event) {
    const createdAt = new Date().toISOString();
    const deliveryId = `whdel-${(0, node_crypto_1.randomBytes)(6).toString('hex')}`;
    const { body } = buildWebhookEnvelope({
        deliveryId,
        type: event.type,
        createdAt,
        data: event.data,
    });
    const payloadHash = (0, webhook_retry_js_1.hashPayload)(body);
    const pending = (0, webhook_store_js_1.recordWebhookDelivery)({
        id: deliveryId,
        subscriptionId: subscription.id,
        eventType: event.type,
        entityId: event.entityId ?? null,
        status: 'PENDING',
        attemptCount: 0,
        responseCode: null,
        lastError: null,
        deliveredAt: null,
        createdAt,
        payloadHash,
        nextRetryAt: null,
        body,
    });
    const signature = (0, webhook_events_js_1.signWebhookBody)(subscription.signingSecret, body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
        const response = await transport(subscription.endpointUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Invexa-Event': event.type,
                'X-Invexa-Delivery': pending.id,
                'X-Invexa-Timestamp': createdAt,
                'X-Invexa-Signature': `sha256=${signature}`,
            },
            body,
            signal: controller.signal,
        });
        pending.attemptCount = 1;
        pending.responseCode = response.status;
        if (response.status >= 200 && response.status < 300) {
            pending.status = 'DELIVERED';
            pending.deliveredAt = new Date().toISOString();
            pending.lastError = null;
        }
        else {
            pending.status = 'FAILED';
            pending.lastError = `Endpoint responded with ${response.status}`;
            pending.nextRetryAt = (0, webhook_retry_js_1.nextRetryAt)(pending.attemptCount);
        }
    }
    catch (error) {
        pending.attemptCount = 1;
        pending.status = 'FAILED';
        pending.lastError = error instanceof Error ? error.message : 'Webhook delivery failed.';
        pending.nextRetryAt = (0, webhook_retry_js_1.nextRetryAt)(pending.attemptCount);
    }
    finally {
        clearTimeout(timer);
    }
    await persistDelivery(pending);
    return { ...pending };
}
async function persistDelivery(row) {
    if (!persistence_js_1.databaseEnabled)
        return;
    await db_js_1.prisma.webhookDeliveryLog.upsert({
        where: { id: row.id },
        update: {
            status: row.status,
            attemptCount: row.attemptCount,
            responseCode: row.responseCode,
            lastError: row.lastError,
            deliveredAt: row.deliveredAt ? new Date(row.deliveredAt) : null,
            payloadHash: row.payloadHash,
            nextRetryAt: row.nextRetryAt ? new Date(row.nextRetryAt) : null,
            body: row.body,
        },
        create: {
            id: row.id,
            subscriptionId: row.subscriptionId,
            eventType: row.eventType,
            entityId: row.entityId,
            status: row.status,
            attemptCount: row.attemptCount,
            responseCode: row.responseCode,
            lastError: row.lastError,
            createdAt: new Date(row.createdAt),
            deliveredAt: row.deliveredAt ? new Date(row.deliveredAt) : null,
            payloadHash: row.payloadHash,
            nextRetryAt: row.nextRetryAt ? new Date(row.nextRetryAt) : null,
            body: row.body,
        },
    }).catch(() => undefined);
}
class WebhookReplayError extends Error {
}
exports.WebhookReplayError = WebhookReplayError;
/**
 * Dead-letter replay: re-sends the exact stored payload (same deliveryId,
 * so a receiver deduping on X-Invexa-Delivery sees this as the same logical
 * delivery, not a new one) to the same subscription. Only a FAILED delivery
 * can be replayed - a DELIVERED one is done, and a PENDING one is still in
 * flight.
 */
async function replayDelivery(deliveryId) {
    const record = await findDeliveryForReplay(deliveryId);
    if (!record)
        throw new WebhookReplayError('Delivery was not found.');
    if (record.status !== 'FAILED')
        throw new WebhookReplayError(`Only a FAILED delivery can be replayed (this one is ${record.status}).`);
    if (!record.body)
        throw new WebhookReplayError('This delivery has no stored payload to replay.');
    const subscription = (0, webhook_store_js_1.getWebhookSubscription)(record.subscriptionId);
    if (!subscription)
        throw new WebhookReplayError('The webhook subscription for this delivery no longer exists.');
    const signature = (0, webhook_events_js_1.signWebhookBody)(subscription.signingSecret, record.body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
        const response = await transport(subscription.endpointUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Invexa-Event': record.eventType,
                'X-Invexa-Delivery': record.id,
                'X-Invexa-Timestamp': record.createdAt,
                'X-Invexa-Signature': `sha256=${signature}`,
                'X-Invexa-Replay': 'true',
            },
            body: record.body,
            signal: controller.signal,
        });
        record.attemptCount += 1;
        record.responseCode = response.status;
        if (response.status >= 200 && response.status < 300) {
            record.status = 'DELIVERED';
            record.deliveredAt = new Date().toISOString();
            record.lastError = null;
            record.nextRetryAt = null;
        }
        else {
            record.status = 'FAILED';
            record.lastError = `Endpoint responded with ${response.status}`;
            record.nextRetryAt = (0, webhook_retry_js_1.nextRetryAt)(record.attemptCount);
        }
    }
    catch (error) {
        record.attemptCount += 1;
        record.status = 'FAILED';
        record.lastError = error instanceof Error ? error.message : 'Webhook delivery failed.';
        record.nextRetryAt = (0, webhook_retry_js_1.nextRetryAt)(record.attemptCount);
    }
    finally {
        clearTimeout(timer);
    }
    (0, webhook_store_js_1.updateWebhookDelivery)(record.id, record);
    await persistDelivery(record);
    return { ...record };
}
async function findDeliveryForReplay(deliveryId) {
    const memory = (0, webhook_store_js_1.getWebhookDelivery)(deliveryId);
    if (memory)
        return memory;
    if (!persistence_js_1.databaseEnabled)
        return undefined;
    const row = await db_js_1.prisma.webhookDeliveryLog.findUnique({ where: { id: deliveryId } }).catch(() => null);
    if (!row)
        return undefined;
    return {
        id: row.id, subscriptionId: row.subscriptionId, eventType: row.eventType, entityId: row.entityId,
        status: row.status, attemptCount: row.attemptCount, responseCode: row.responseCode,
        lastError: row.lastError, createdAt: row.createdAt.toISOString(), deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
        payloadHash: row.payloadHash, nextRetryAt: row.nextRetryAt ? row.nextRetryAt.toISOString() : null, body: row.body,
    };
}
async function retryDueDeliveries() {
    const now = new Date();
    const dueIds = new Set((0, webhook_store_js_1.listDueRetries)(now.toISOString()).map((row) => row.id));
    if (persistence_js_1.databaseEnabled) {
        const persistedDue = await db_js_1.prisma.webhookDeliveryLog.findMany({
            where: { status: 'FAILED', nextRetryAt: { lte: now } },
            select: { id: true },
        }).catch(() => []);
        for (const row of persistedDue)
            dueIds.add(row.id);
    }
    let delivered = 0;
    for (const id of dueIds) {
        try {
            const result = await replayDelivery(id);
            if (result.status === 'DELIVERED')
                delivered += 1;
        }
        catch {
            // A subscription/record that vanished mid-sweep is not this sweep's problem.
        }
    }
    return { retried: dueIds.size, delivered };
}
async function dispatchWebhookEvent(event) {
    const targets = (0, webhook_store_js_1.listMatchingSubscriptions)(event.type);
    const delivered = [];
    for (const subscription of targets) {
        delivered.push(await deliverSubscription(subscription, event));
    }
    const companyId = (0, webhook_bridge_js_1.resolveCompanyIdFromEvent)(event.data);
    if (companyId) {
        for (const hook of (0, webhook_bridge_js_1.listControlPlaneWebhookTargets)(companyId, event.type)) {
            delivered.push(await deliverSubscription({
                id: hook.id,
                name: hook.name,
                endpointUrl: hook.url,
                events: [event.type],
                signingSecret: hook.signingSecret,
                secretHash: '',
                status: 'ACTIVE',
                createdAt: hook.createdAt,
                updatedAt: hook.createdAt,
            }, event));
        }
    }
    return delivered;
}
function emitWebhookEvent(event) {
    const run = dispatchWebhookEvent(event).catch(() => []);
    inflight.add(run);
    void run.finally(() => inflight.delete(run));
    return run;
}
function emitTransferUpdated(transfer) {
    return emitWebhookEvent({
        type: 'transfer.updated',
        entityId: transfer.id,
        data: {
            transferId: transfer.id,
            status: transfer.status,
            sourceLocationId: transfer.sourceLocationId,
            destinationLocationId: transfer.destinationLocationId,
            cartonCount: transfer.cartonCount ?? null,
        },
    });
}
function itemOnHand(itemId, locationId) {
    return (0, repository_js_1.listStockLedger)()
        .filter((row) => row.itemId === itemId && row.locationId === locationId)
        .reduce((sum, row) => sum + row.onHand, 0);
}
function maybeEmitStockLow(itemId, locationId, beforeOnHand) {
    const rule = (0, reorder_store_js_1.listReorderRules)(locationId).find((entry) => entry.itemId === itemId);
    if (!rule)
        return;
    const afterOnHand = itemOnHand(itemId, locationId);
    if (afterOnHand > rule.minQty || beforeOnHand <= rule.minQty)
        return;
    void emitWebhookEvent({
        type: 'stock.low',
        entityId: itemId,
        data: { itemId, locationId, onHand: afterOnHand, minQty: rule.minQty, targetQty: rule.targetQty },
    });
}
