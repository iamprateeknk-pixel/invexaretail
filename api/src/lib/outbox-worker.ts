// ADR-006 / Week 7: idempotent delivery worker for the durable
// `DomainEventOutbox`. Nothing has drained this table until now - it was
// purely a replay buffer for reconnecting SSE clients (`routes/events.ts`).
// This worker is the first real *consumer*: it claims a batch of pending
// rows, hands each to a delivery handler, and durably records the outcome
// so a crash between "business commit" and "event delivered" can never
// silently lose the event (the row is still PENDING after a crash - the
// next run picks it back up) and a crash *after* delivery but before the
// row is marked DELIVERED at worst redelivers once, which delivery handlers
// must tolerate (this module names that requirement; enforcing it is each
// handler's job, the same idempotency-key discipline used throughout the
// rest of the codebase).
import { prisma, queryRaw, executeRaw } from './db.js';
import { databaseEnabled } from './persistence.js';
import type { DomainEvent, EventTopic } from './event-bus.js';

export const MAX_DELIVERY_ATTEMPTS = 5;
// Exponential backoff, capped: 2s, 4s, 8s, 16s, 32s (then poisoned).
const BACKOFF_BASE_MS = 2000;

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

export class PoisonEventError extends Error {
  constructor(public readonly outboxId: bigint, public readonly cause: unknown) {
    super(`Outbox event ${outboxId} exceeded ${MAX_DELIVERY_ATTEMPTS} delivery attempts and was marked POISON.`);
    this.name = 'PoisonEventError';
  }
}

function toDomainEvent(row: OutboxRow): DomainEvent {
  return {
    id: Number(row.id),
    topic: row.topic as EventTopic,
    companyId: row.companyId,
    locationIds: Array.isArray(row.locationIds) ? (row.locationIds as string[]) : undefined,
    actorId: row.actorId ?? undefined,
    requestId: row.requestId ?? undefined,
    at: row.occurredAt.toISOString(),
  };
}

/**
 * Claims up to `batchSize` PENDING rows whose `availableAt` has passed,
 * using `FOR UPDATE SKIP LOCKED` so more than one worker process can poll
 * the same table concurrently without either double-claiming a row or
 * blocking on one another's in-flight rows - this is the "durable cursor":
 * `status` + `availableAt` on the row itself, not a separate offset table
 * that could itself drift from what was actually delivered.
 */
async function claimBatch(batchSize: number): Promise<OutboxRow[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await queryRaw<OutboxRow[]>(
      tx,
      `SELECT id, topic, "companyId", "locationIds", "actorId", "requestId", "occurredAt", attempts
       FROM "DomainEventOutbox"
       WHERE status = 'PENDING' AND "availableAt" <= now()
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      batchSize,
    );
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await executeRaw(
      tx,
      `UPDATE "DomainEventOutbox" SET "availableAt" = now() + interval '30 seconds' WHERE id = ANY(?::bigint[])`,
      ids,
    );
    return rows;
  });
}

async function markDelivered(id: bigint): Promise<void> {
  await executeRaw(
    prisma,
    `UPDATE "DomainEventOutbox" SET status = 'DELIVERED', "deliveredAt" = now() WHERE id = ?`,
    id,
  );
}

async function markFailedOrPoison(id: bigint, attempts: number, error: unknown): Promise<'RETRY' | 'POISON'> {
  const message = error instanceof Error ? error.message : String(error);
  const nextAttempts = attempts + 1;
  if (nextAttempts >= MAX_DELIVERY_ATTEMPTS) {
    await executeRaw(
      prisma,
      `UPDATE "DomainEventOutbox" SET status = 'POISON', attempts = ?, "lastError" = ? WHERE id = ?`,
      nextAttempts,
      message.slice(0, 2000),
      id,
    );
    return 'POISON';
  }
  const backoffMs = BACKOFF_BASE_MS * 2 ** attempts;
  await executeRaw(
    prisma,
    `UPDATE "DomainEventOutbox" SET status = 'PENDING', attempts = ?, "lastError" = ?, "availableAt" = now() + (? || ' milliseconds')::interval WHERE id = ?`,
    nextAttempts,
    message.slice(0, 2000),
    backoffMs,
    id,
  );
  return 'RETRY';
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
export async function drainOutboxOnce(handler: DeliveryHandler, batchSize = 50): Promise<DrainResult> {
  if (!databaseEnabled) return { claimed: 0, delivered: 0, retried: 0, poisoned: 0 };
  const rows = await claimBatch(batchSize);
  const result: DrainResult = { claimed: rows.length, delivered: 0, retried: 0, poisoned: 0 };
  for (const row of rows) {
    try {
      await handler(toDomainEvent(row));
      await markDelivered(row.id);
      result.delivered += 1;
    } catch (error) {
      const outcome = await markFailedOrPoison(row.id, row.attempts, error);
      if (outcome === 'POISON') result.poisoned += 1;
      else result.retried += 1;
    }
  }
  return result;
}

export async function listPoisonEvents(companyId?: string): Promise<OutboxRow[]> {
  if (!databaseEnabled) return [];
  return companyId
    ? queryRaw<OutboxRow[]>(
        prisma,
        `SELECT id, topic, "companyId", "locationIds", "actorId", "requestId", "occurredAt", attempts
         FROM "DomainEventOutbox" WHERE status = 'POISON' AND "companyId" = ? ORDER BY id ASC`,
        companyId,
      )
    : queryRaw<OutboxRow[]>(
        prisma,
        `SELECT id, topic, "companyId", "locationIds", "actorId", "requestId", "occurredAt", attempts
         FROM "DomainEventOutbox" WHERE status = 'POISON' ORDER BY id ASC`,
      );
}

/** Operator recovery path: requeue a poison event for one more delivery attempt. */
export async function requeuePoisonEvent(id: bigint): Promise<void> {
  await executeRaw(
    prisma,
    `UPDATE "DomainEventOutbox" SET status = 'PENDING', attempts = 0, "availableAt" = now(), "lastError" = NULL WHERE id = ? AND status = 'POISON'`,
    id,
  );
}

let pollTimer: NodeJS.Timeout | null = null;

/** Starts a background poll loop. Call `stopOutboxWorker()` to stop it (used in tests and graceful shutdown). */
export function startOutboxWorker(handler: DeliveryHandler, intervalMs = 2000): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    drainOutboxOnce(handler).catch((error) => console.error('[outbox-worker] drain failed', error));
  }, intervalMs);
  pollTimer.unref?.();
}

export function stopOutboxWorker(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
