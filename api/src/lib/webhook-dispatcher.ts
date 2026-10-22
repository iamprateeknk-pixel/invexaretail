import { randomBytes } from 'node:crypto';
import { listReorderRules } from './reorder-store.js';
import { listStockForLocation } from './repositories/stock-repository.js';
import type { TenantContext } from './tenant-context.js';
import { databaseEnabled } from './persistence.js';
import { prisma } from './db.js';
import {
  signWebhookBody,
  type WebhookEventType,
} from './webhook-events.js';
import {
  listMatchingSubscriptions,
  recordWebhookDelivery,
  getWebhookDelivery,
  getWebhookSubscription,
  updateWebhookDelivery,
  listDueRetries,
  type WebhookDeliveryRecord,
  type WebhookSubscriptionRecord,
} from './webhook-store.js';
import { listControlPlaneWebhookTargets, resolveCompanyIdFromEvent } from './webhook-bridge.js';
import { hashPayload, nextRetryAt as computeNextRetryAt } from './webhook-retry.js';

export type WebhookTransportResponse = {
  status: number;
};

export type WebhookTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<WebhookTransportResponse>;

export type WebhookEmitInput = {
  type: WebhookEventType;
  entityId?: string | null;
  data: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 8_000;

const defaultTransport: WebhookTransport = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  return { status: response.status };
};

let transport: WebhookTransport = defaultTransport;
const inflight = new Set<Promise<unknown>>();

export function setWebhookTransport(next: WebhookTransport): void {
  transport = next;
}

export function resetWebhookTransport(): void {
  transport = defaultTransport;
}

export async function waitForWebhooks(): Promise<void> {
  await Promise.all([...inflight]);
}

export function buildWebhookEnvelope(input: {
  deliveryId: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}): { body: string; payload: Record<string, unknown> } {
  const payload = {
    id: input.deliveryId,
    event: input.type,
    createdAt: input.createdAt,
    data: input.data,
  };
  return { payload, body: JSON.stringify(payload) };
}

export async function deliverSubscription(
  subscription: WebhookSubscriptionRecord,
  event: WebhookEmitInput,
  companyId: string = subscription.companyId,
): Promise<WebhookDeliveryRecord> {
  const createdAt = new Date().toISOString();
  const deliveryId = `whdel-${randomBytes(6).toString('hex')}`;
  const { body } = buildWebhookEnvelope({
    deliveryId,
    type: event.type,
    createdAt,
    data: event.data,
  });
  const payloadHash = hashPayload(body);
  const pending = recordWebhookDelivery({
    id: deliveryId,
    companyId,
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
  const signature = signWebhookBody(subscription.signingSecret, body);
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
    } else {
      pending.status = 'FAILED';
      pending.lastError = `Endpoint responded with ${response.status}`;
      pending.nextRetryAt = computeNextRetryAt(pending.attemptCount);
    }
  } catch (error) {
    pending.attemptCount = 1;
    pending.status = 'FAILED';
    pending.lastError = error instanceof Error ? error.message : 'Webhook delivery failed.';
    pending.nextRetryAt = computeNextRetryAt(pending.attemptCount);
  } finally {
    clearTimeout(timer);
  }
  await persistDelivery(pending);
  return { ...pending };
}

export async function persistDelivery(row: WebhookDeliveryRecord): Promise<void> {
  if (!databaseEnabled) return;
  await prisma.webhookDeliveryLog.upsert({
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
      companyId: row.companyId ?? 'default-company',
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

export class WebhookReplayError extends Error {}

/**
 * Dead-letter replay: re-sends the exact stored payload (same deliveryId,
 * so a receiver deduping on X-Invexa-Delivery sees this as the same logical
 * delivery, not a new one) to the same subscription. Only a FAILED delivery
 * can be replayed - a DELIVERED one is done, and a PENDING one is still in
 * flight.
 */
export async function replayDelivery(deliveryId: string, companyId?: string): Promise<WebhookDeliveryRecord> {
  const record = await findDeliveryForReplay(deliveryId);
  // A foreign company's delivery is indistinguishable from a missing one.
  if (!record || (companyId !== undefined && record.companyId !== companyId)) throw new WebhookReplayError('Delivery was not found.');
  if (record.status !== 'FAILED') throw new WebhookReplayError(`Only a FAILED delivery can be replayed (this one is ${record.status}).`);
  if (!record.body) throw new WebhookReplayError('This delivery has no stored payload to replay.');
  const subscription = getWebhookSubscription(record.subscriptionId);
  if (!subscription) throw new WebhookReplayError('The webhook subscription for this delivery no longer exists.');

  const signature = signWebhookBody(subscription.signingSecret, record.body);
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
    } else {
      record.status = 'FAILED';
      record.lastError = `Endpoint responded with ${response.status}`;
      record.nextRetryAt = computeNextRetryAt(record.attemptCount);
    }
  } catch (error) {
    record.attemptCount += 1;
    record.status = 'FAILED';
    record.lastError = error instanceof Error ? error.message : 'Webhook delivery failed.';
    record.nextRetryAt = computeNextRetryAt(record.attemptCount);
  } finally {
    clearTimeout(timer);
  }
  updateWebhookDelivery(record.id, record);
  await persistDelivery(record);
  return { ...record };
}

async function findDeliveryForReplay(deliveryId: string): Promise<WebhookDeliveryRecord | undefined> {
  const memory = getWebhookDelivery(deliveryId);
  if (memory) return memory;
  if (!databaseEnabled) return undefined;
  const row = await prisma.webhookDeliveryLog.findUnique({ where: { id: deliveryId } }).catch(() => null);
  if (!row) return undefined;
  return {
    id: row.id, companyId: row.companyId, subscriptionId: row.subscriptionId, eventType: row.eventType, entityId: row.entityId,
    status: row.status as WebhookDeliveryRecord['status'], attemptCount: row.attemptCount, responseCode: row.responseCode,
    lastError: row.lastError, createdAt: row.createdAt.toISOString(), deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    payloadHash: row.payloadHash, nextRetryAt: row.nextRetryAt ? row.nextRetryAt.toISOString() : null, body: row.body,
  };
}

export async function retryDueDeliveries(companyId?: string): Promise<{ retried: number; delivered: number }> {
  const now = new Date();
  const dueIds = new Set(listDueRetries(now.toISOString()).filter((row) => companyId === undefined || row.companyId === companyId).map((row) => row.id));
  if (databaseEnabled) {
    const persistedDue = await prisma.webhookDeliveryLog.findMany({
      where: { status: 'FAILED', nextRetryAt: { lte: now }, ...(companyId === undefined ? {} : { companyId }) },
      select: { id: true },
    }).catch(() => []);
    for (const row of persistedDue) dueIds.add(row.id);
  }
  let delivered = 0;
  for (const id of dueIds) {
    try {
      const result = await replayDelivery(id);
      if (result.status === 'DELIVERED') delivered += 1;
    } catch {
      // A subscription/record that vanished mid-sweep is not this sweep's problem.
    }
  }
  return { retried: dueIds.size, delivered };
}

export async function dispatchWebhookEvent(event: WebhookEmitInput): Promise<WebhookDeliveryRecord[]> {
  const delivered: WebhookDeliveryRecord[] = [];
  // An event is only ever delivered to subscriptions of the company that produced it. If the
  // company cannot be determined the event is dropped: guessing would send one tenant's data to another.
  const companyId = resolveCompanyIdFromEvent(event.data);
  if (companyId) {
    for (const subscription of listMatchingSubscriptions(event.type, companyId)) {
      delivered.push(await deliverSubscription(subscription, event, companyId));
    }
  }
  if (companyId) {
    for (const hook of listControlPlaneWebhookTargets(companyId, event.type)) {
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
        companyId,
      }, event, companyId));
    }
  }
  return delivered;
}

export function emitWebhookEvent(event: WebhookEmitInput): Promise<WebhookDeliveryRecord[]> {
  const run = dispatchWebhookEvent(event).catch(() => [] as WebhookDeliveryRecord[]);
  inflight.add(run);
  void run.finally(() => inflight.delete(run));
  return run;
}

export function emitTransferUpdated(transfer: {
  id: string;
  status: string;
  sourceLocationId: string;
  destinationLocationId: string;
  cartonCount?: number | null;
}): Promise<WebhookDeliveryRecord[]> {
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

export async function itemOnHand(ctx: TenantContext, itemId: string, locationId: string): Promise<number> {
  // Phase 5 step 10: the low-stock check reads the stock the database
  // holds now (repository), not the snapshot — the snapshot could still
  // show pre-approval quantities and suppress a genuine low-stock event.
  return (await listStockForLocation(ctx, locationId))
    .filter((row) => row.itemId === itemId)
    .reduce((sum, row) => sum + row.onHand, 0);
}

export async function maybeEmitStockLow(ctx: TenantContext, itemId: string, locationId: string, beforeOnHand: number): Promise<void> {
  const rule = listReorderRules(locationId).find((entry) => entry.itemId === itemId);
  if (!rule) return;
  const afterOnHand = await itemOnHand(ctx, itemId, locationId);
  if (afterOnHand > rule.minQty || beforeOnHand <= rule.minQty) return;
  void emitWebhookEvent({
    type: 'stock.low',
    entityId: itemId,
    data: { itemId, locationId, onHand: afterOnHand, minQty: rule.minQty, targetQty: rule.targetQty },
  });
}
