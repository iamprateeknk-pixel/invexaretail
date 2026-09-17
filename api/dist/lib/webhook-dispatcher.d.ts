import { type WebhookEventType } from './webhook-events.js';
import { type WebhookDeliveryRecord, type WebhookSubscriptionRecord } from './webhook-store.js';
export type WebhookTransportResponse = {
    status: number;
};
export type WebhookTransport = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
}) => Promise<WebhookTransportResponse>;
export type WebhookEmitInput = {
    type: WebhookEventType;
    entityId?: string | null;
    data: Record<string, unknown>;
};
export declare function setWebhookTransport(next: WebhookTransport): void;
export declare function resetWebhookTransport(): void;
export declare function waitForWebhooks(): Promise<void>;
export declare function buildWebhookEnvelope(input: {
    deliveryId: string;
    type: string;
    createdAt: string;
    data: Record<string, unknown>;
}): {
    body: string;
    payload: Record<string, unknown>;
};
export declare function deliverSubscription(subscription: WebhookSubscriptionRecord, event: WebhookEmitInput): Promise<WebhookDeliveryRecord>;
export declare function persistDelivery(row: WebhookDeliveryRecord): Promise<void>;
export declare class WebhookReplayError extends Error {
}
/**
 * Dead-letter replay: re-sends the exact stored payload (same deliveryId,
 * so a receiver deduping on X-Invexa-Delivery sees this as the same logical
 * delivery, not a new one) to the same subscription. Only a FAILED delivery
 * can be replayed - a DELIVERED one is done, and a PENDING one is still in
 * flight.
 */
export declare function replayDelivery(deliveryId: string): Promise<WebhookDeliveryRecord>;
export declare function retryDueDeliveries(): Promise<{
    retried: number;
    delivered: number;
}>;
export declare function dispatchWebhookEvent(event: WebhookEmitInput): Promise<WebhookDeliveryRecord[]>;
export declare function emitWebhookEvent(event: WebhookEmitInput): Promise<WebhookDeliveryRecord[]>;
export declare function emitTransferUpdated(transfer: {
    id: string;
    status: string;
    sourceLocationId: string;
    destinationLocationId: string;
    cartonCount?: number | null;
}): Promise<WebhookDeliveryRecord[]>;
export declare function itemOnHand(itemId: string, locationId: string): number;
export declare function maybeEmitStockLow(itemId: string, locationId: string, beforeOnHand: number): void;
