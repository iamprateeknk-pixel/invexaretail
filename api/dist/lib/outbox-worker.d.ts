import type { DomainEvent } from './event-bus.js';
export declare const MAX_DELIVERY_ATTEMPTS = 5;
export type OutboxRow = {
    id: bigint;
    topic: string;
    companyId: string;
    locationIds: unknown;
    actorId: string | null;
    requestId: string | null;
    occurredAt: Date;
    attempts: number;
};
export type DeliveryHandler = (event: DomainEvent) => Promise<void> | void;
export declare class PoisonEventError extends Error {
    readonly outboxId: bigint;
    readonly cause: unknown;
    constructor(outboxId: bigint, cause: unknown);
}
export type DrainResult = {
    claimed: number;
    delivered: number;
    retried: number;
    poisoned: number;
};
/**
 * Drains one batch. Each row is delivered and resolved independently, so
 * one poison event never blocks the rows behind it. Idempotent to call
 * repeatedly (a crashed run simply leaves its claimed-but-unresolved rows
 * to fall back to PENDING once their claim's `availableAt` lease expires,
 * picked up by the next drain).
 */
export declare function drainOutboxOnce(handler: DeliveryHandler, batchSize?: number): Promise<DrainResult>;
export declare function listPoisonEvents(companyId?: string): Promise<OutboxRow[]>;
/** Operator recovery path: requeue a poison event for one more delivery attempt. */
export declare function requeuePoisonEvent(id: bigint): Promise<void>;
/** Starts a background poll loop. Call `stopOutboxWorker()` to stop it (used in tests and graceful shutdown). */
export declare function startOutboxWorker(handler: DeliveryHandler, intervalMs?: number): void;
export declare function stopOutboxWorker(): void;
