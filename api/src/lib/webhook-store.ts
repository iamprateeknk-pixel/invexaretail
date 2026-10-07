import { randomBytes } from 'node:crypto';

import {
  hashWebhookSecret,
  parseWebhookEndpoint,
  parseWebhookEvents,
  parseWebhookName,
  type WebhookEventType,
} from './webhook-events.js';

export type WebhookStatus = 'ACTIVE' | 'PAUSED';
export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export type WebhookSubscriptionRecord = {
  id: string;
  name: string;
  endpointUrl: string;
  events: WebhookEventType[];
  secretHash: string;
  signingSecret: string;
  status: WebhookStatus;
  createdAt: string;
  updatedAt: string;
  /** The company whose events this subscription receives - and the only one that may see or change it. */
  companyId: string;
};

export type WebhookDeliveryRecord = {
  id: string;
  /** Owning company, copied from the event that produced the delivery. */
  companyId?: string;
  subscriptionId: string;
  eventType: string;
  entityId: string | null;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  payloadHash: string | null;
  nextRetryAt: string | null;
  body: string | null;
};

export type PublicWebhookSubscription = Omit<WebhookSubscriptionRecord, 'signingSecret' | 'secretHash' | 'companyId'>;

const subscriptions: WebhookSubscriptionRecord[] = [];
const deliveries: WebhookDeliveryRecord[] = [];

export function resetWebhookStore(): void {
  subscriptions.splice(0, subscriptions.length);
  deliveries.splice(0, deliveries.length);
}

export function toPublicSubscription(record: WebhookSubscriptionRecord): PublicWebhookSubscription {
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

export function listWebhookSubscriptions(companyId: string): PublicWebhookSubscription[] {
  return subscriptions
    .filter((subscription) => subscription.companyId === companyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toPublicSubscription);
}

export function listMatchingSubscriptions(eventType: string, companyId: string): WebhookSubscriptionRecord[] {
  return subscriptions.filter((subscription) =>
    subscription.companyId === companyId && subscription.status === 'ACTIVE' && subscription.events.includes(eventType as WebhookEventType),
  );
}

export function getWebhookSubscription(id: string): WebhookSubscriptionRecord | undefined {
  return subscriptions.find((subscription) => subscription.id === id);
}

export function createWebhookSubscription(input: {
  name: unknown;
  endpointUrl: unknown;
  events: unknown;
  allowPrivate?: boolean;
  id?: string;
  signingSecret?: string;
  companyId: string;
}): { subscription: PublicWebhookSubscription; signingSecret: string } {
  const name = parseWebhookName(input.name);
  const events = parseWebhookEvents(input.events);
  const endpoint = parseWebhookEndpoint(input.endpointUrl, { allowPrivate: input.allowPrivate });
  const now = new Date().toISOString();
  const signingSecret = input.signingSecret ?? randomBytes(32).toString('hex');
  const record: WebhookSubscriptionRecord = {
    id: input.id ?? `hook-${randomBytes(6).toString('hex')}`,
    name,
    endpointUrl: endpoint.toString(),
    events,
    secretHash: hashWebhookSecret(signingSecret),
    signingSecret,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    companyId: input.companyId,
  };
  subscriptions.unshift(record);
  return { subscription: toPublicSubscription(record), signingSecret };
}

export function setWebhookSubscriptionStatus(id: string, status: string, companyId: string): PublicWebhookSubscription {
  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    throw new Error('Status must be ACTIVE or PAUSED.');
  }
  // A foreign company's id is indistinguishable from a missing one.
  const record = subscriptions.find((subscription) => subscription.id === id && subscription.companyId === companyId);
  if (!record) throw new Error('Webhook subscription was not found.');
  record.status = status;
  record.updatedAt = new Date().toISOString();
  return toPublicSubscription(record);
}

export function listWebhookDeliveries(limit = 100, companyId?: string): WebhookDeliveryRecord[] {
  return (companyId === undefined ? deliveries : deliveries.filter((row) => row.companyId === companyId)).slice(0, limit).map((row) => ({ ...row }));
}

export function recordWebhookDelivery(input: Omit<WebhookDeliveryRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): WebhookDeliveryRecord {
  const record: WebhookDeliveryRecord = {
    id: input.id ?? `whdel-${randomBytes(6).toString('hex')}`,
    companyId: input.companyId,
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

export function getWebhookDelivery(id: string): WebhookDeliveryRecord | undefined {
  const record = deliveries.find((row) => row.id === id);
  return record ? { ...record } : undefined;
}

export function updateWebhookDelivery(id: string, patch: Partial<WebhookDeliveryRecord>): WebhookDeliveryRecord | undefined {
  const record = deliveries.find((row) => row.id === id);
  if (!record) return undefined;
  Object.assign(record, patch);
  return { ...record };
}

export function listDueRetries(now: string = new Date().toISOString()): WebhookDeliveryRecord[] {
  return deliveries.filter((row) => row.status === 'FAILED' && row.nextRetryAt && row.nextRetryAt <= now).map((row) => ({ ...row }));
}
