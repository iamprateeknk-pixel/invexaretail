export declare const WEBHOOK_EVENTS: readonly ["stock.low", "transfer.updated", "purchase-order.received", "count.reviewed"];
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
export declare class WebhookValidationError extends Error {
    readonly status: number;
    constructor(message: string, status?: number);
}
export declare function isWebhookEvent(value: string): value is WebhookEventType;
export declare function parseWebhookEvents(value: unknown): WebhookEventType[];
export declare function parseWebhookName(value: unknown): string;
export declare function parseWebhookEndpoint(raw: unknown, options?: {
    allowPrivate?: boolean;
}): URL;
export declare function hashWebhookSecret(secret: string): string;
export declare function signWebhookBody(secret: string, body: string): string;
export declare function verifyWebhookSignature(secret: string, body: string, signature: string): boolean;
export declare function encryptWebhookSecret(plain: string): string;
export declare function decryptWebhookSecret(payload: string | null | undefined): string | null;
