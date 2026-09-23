"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoisonEventError = exports.MAX_DELIVERY_ATTEMPTS = void 0;
exports.drainOutboxOnce = drainOutboxOnce;
exports.listPoisonEvents = listPoisonEvents;
exports.requeuePoisonEvent = requeuePoisonEvent;
exports.startOutboxWorker = startOutboxWorker;
exports.stopOutboxWorker = stopOutboxWorker;
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
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
exports.MAX_DELIVERY_ATTEMPTS = 5;
// Exponential backoff, capped: 2s, 4s, 8s, 16s, 32s (then poisoned).
const BACKOFF_BASE_MS = 2000;
class PoisonEventError extends Error {
    outboxId;
    cause;
    constructor(outboxId, cause) {
        super(`Outbox event ${outboxId} exceeded ${exports.MAX_DELIVERY_ATTEMPTS} delivery attempts and was marked POISON.`);
        this.outboxId = outboxId;
        this.cause = cause;
        this.name = 'PoisonEventError';
    }
}
exports.PoisonEventError = PoisonEventError;
function toDomainEvent(row) {
    return {
        id: Number(row.id),
        topic: row.topic,
        companyId: row.companyId,
        locationIds: Array.isArray(row.locationIds) ? row.locationIds : undefined,
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
async function claimBatch(batchSize) {
    return db_js_1.prisma.$transaction(async (tx) => {
        const rows = await (0, db_js_1.queryRaw)(tx, `SELECT id, topic, "companyId", "locationIds", "actorId", "requestId", "occurredAt", attempts
       FROM "DomainEventOutbox"
       WHERE status = 'PENDING' AND "availableAt" <= now()
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`, batchSize);
        if (!rows.length)
            return [];
        const ids = rows.map((r) => r.id);
        await (0, db_js_1.executeRaw)(tx, `UPDATE "DomainEventOutbox" SET "availableAt" = now() + interval '30 seconds' WHERE id = ANY(?::bigint[])`, ids);
        return rows;
    });
}
async function markDelivered(id) {
    await (0, db_js_1.executeRaw)(db_js_1.prisma, `UPDATE "DomainEventOutbox" SET status = 'DELIVERED', "deliveredAt" = now() WHERE id = ?`, id);
}
async function markFailedOrPoison(id, attempts, error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextAttempts = attempts + 1;
    if (nextAttempts >= exports.MAX_DELIVERY_ATTEMPTS) {
        await (0, db_js_1.executeRaw)(db_js_1.prisma, `UPDATE "DomainEventOutbox" SET status = 'POISON', attempts = ?, "lastError" = ? WHERE id = ?`, nextAttempts, message.slice(0, 2000), id);
        return 'POISON';
    }
    const backoffMs = BACKOFF_BASE_MS * 2 ** attempts;
    await (0, db_js_1.executeRaw)(db_js_1.prisma, `UPDATE "DomainEventOutbox" SET status = 'PENDING', attempts = ?, "lastError" = ?, "availableAt" = now() + (? || ' milliseconds')::interval WHERE id = ?`, nextAttempts, message.slice(0, 2000), backoffMs, id);
    return 'RETRY';
}
/**
 * Drains one batch. Each row is delivered and resolved independently, so
 * one poison event never blocks the rows behind it. Idempotent to call
 * repeatedly (a crashed run simply leaves its claimed-but-unresolved rows
 * to fall back to PENDING once their claim's `availableAt` lease expires,
 * picked up by the next drain).
 */
async function drainOutboxOnce(handler, batchSize = 50) {
    if (!persistence_js_1.databaseEnabled)
        return { claimed: 0, delivered: 0, retried: 0, poisoned: 0 };
    const rows = await claimBatch(batchSize);
    const result = { claimed: rows.length, delivered: 0, retried: 0, poisoned: 0 };
    for (const row of rows) {
        try {
            await handler(toDomainEvent(row));
            await markDelivered(row.id);
            result.delivered += 1;
        }
        catch (error) {
            const outcome = await markFailedOrPoison(row.id, row.attempts, error);
            if (outcome === 'POISON')
                result.poisoned += 1;
            else
                result.retried += 1;
        }
    }
    return result;
}
async function listPoisonEvents(companyId) {
    if (!persistence_js_1.databaseEnabled)
        return [];
    return companyId
        ? (0, db_js_1.queryRaw)(db_js_1.prisma, `SELECT id, topic, "companyId", "locationIds", "actorId", "requestId", "occurredAt", attempts
         FROM "DomainEventOutbox" WHERE status = 'POISON' AND "companyId" = ? ORDER BY id ASC`, companyId)
        : (0, db_js_1.queryRaw)(db_js_1.prisma, `SELECT id, topic, "companyId", "locationIds", "actorId", "requestId", "occurredAt", attempts
         FROM "DomainEventOutbox" WHERE status = 'POISON' ORDER BY id ASC`);
}
/** Operator recovery path: requeue a poison event for one more delivery attempt. */
async function requeuePoisonEvent(id) {
    await (0, db_js_1.executeRaw)(db_js_1.prisma, `UPDATE "DomainEventOutbox" SET status = 'PENDING', attempts = 0, "availableAt" = now(), "lastError" = NULL WHERE id = ? AND status = 'POISON'`, id);
}
let pollTimer = null;
/** Starts a background poll loop. Call `stopOutboxWorker()` to stop it (used in tests and graceful shutdown). */
function startOutboxWorker(handler, intervalMs = 2000) {
    if (pollTimer)
        return;
    pollTimer = setInterval(() => {
        drainOutboxOnce(handler).catch((error) => console.error('[outbox-worker] drain failed', error));
    }, intervalMs);
    pollTimer.unref?.();
}
function stopOutboxWorker() {
    if (pollTimer)
        clearInterval(pollTimer);
    pollTimer = null;
}
