import { type WebhookEventType } from './webhook-events.js';
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
};
export type WebhookDeliveryRecord = {
    id: string;
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
export type PublicWebhookSubscription = Omit<WebhookSubscriptionRecord, 'signingSecret' | 'secretHash'>;
export declare function resetWebhookStore(): void;
export declare function toPublicSubscription(record: WebhookSubscriptionRecord): PublicWebhookSubscription;
export declare function listWebhookSubscriptions(): PublicWebhookSubscription[];
export declare function listMatchingSubscriptions(eventType: string): WebhookSubscriptionRecord[];
export declare function getWebhookSubscription(id: string): WebhookSubscriptionRecord | undefined;
export declare function createWebhookSubscription(input: {
    name: unknown;
    endpointUrl: unknown;
    events: unknown;
    allowPrivate?: boolean;
    id?: string;
    signingSecret?: string;
}): {
    subscription: PublicWebhookSubscription;
    signingSecret: string;
};
export declare function setWebhookSubscriptionStatus(id: string, status: string): PublicWebhookSubscription;
export declare function listWebhookDeliveries(limit?: number): WebhookDeliveryRecord[];
export declare function recordWebhookDelivery(input: Omit<WebhookDeliveryRecord, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
}): WebhookDeliveryRecord;
export declare function getWebhookDelivery(id: string): WebhookDeliveryRecord | undefined;
export declare function updateWebhookDelivery(id: string, patch: Partial<WebhookDeliveryRecord>): WebhookDeliveryRecord | undefined;
export declare function listDueRetries(now?: string): WebhookDeliveryRecord[];
