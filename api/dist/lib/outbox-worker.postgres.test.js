"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 7 mandatory verification: "Worker crash between business commit and
// publish does not lose the event" and "Duplicate delivery is harmless and
// poison events become visible exceptions." Exercised against real
// Postgres - see AGENTS.md "Required tests". Skipped unless
// TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const event_bus_js_1 = require("./event-bus.js");
const outbox_worker_js_1 = require("./outbox-worker.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function insertPendingEvent(companyId = `outbox-test-${(0, node_crypto_1.randomUUID)()}`) {
    await db_js_1.prisma.$transaction(async (tx) => {
        await (0, event_bus_js_1.recordOutboxEventInTransaction)(tx, { topic: 'stock.changed', companyId, locationIds: ['loc-1'] });
    });
    const [row] = await db_js_1.prisma.$queryRawUnsafe(`SELECT id FROM "DomainEventOutbox" WHERE "companyId" = $1 ORDER BY id DESC LIMIT 1`, companyId);
    return row.id;
}
integration('an event written in the same transaction as business state is durably PENDING until delivered', async () => {
    const companyId = `outbox-test-${(0, node_crypto_1.randomUUID)()}`;
    const id = await insertPendingEvent(companyId);
    const [row] = await db_js_1.prisma.$queryRawUnsafe(`SELECT status FROM "DomainEventOutbox" WHERE id = $1`, id);
    strict_1.default.equal(row.status, 'PENDING');
});
integration('a worker crash between claiming and processing does not lose the event - it becomes available again after its lease expires', async () => {
    const id = await insertPendingEvent();
    // Simulate a worker that claimed the row (lease pushed forward) and then
    // crashed before marking it delivered: force the lease into the past, as
    // if the 30s claim window had already elapsed, and confirm a fresh drain
    // still picks it up rather than treating "not yet DELIVERED" as lost.
    await (0, db_js_1.executeRaw)(db_js_1.prisma, `UPDATE "DomainEventOutbox" SET status = 'PENDING', "availableAt" = now() - interval '1 second' WHERE id = ?`, id);
    const delivered = [];
    const result = await (0, outbox_worker_js_1.drainOutboxOnce)(async (event) => { delivered.push(BigInt(event.id)); });
    strict_1.default.ok(result.delivered >= 1);
    strict_1.default.ok(delivered.includes(id), 'the event must still be delivered after simulating a crashed prior claim');
    const [row] = await db_js_1.prisma.$queryRawUnsafe(`SELECT status FROM "DomainEventOutbox" WHERE id = $1`, id);
    strict_1.default.equal(row.status, 'DELIVERED');
});
integration('duplicate delivery is harmless: redelivering an already-DELIVERED event is not attempted, and re-running the handler manually for the same id is idempotent by design', async () => {
    const id = await insertPendingEvent();
    const calls = [];
    await (0, outbox_worker_js_1.drainOutboxOnce)(async (event) => { calls.push(BigInt(event.id)); });
    const secondDrain = await (0, outbox_worker_js_1.drainOutboxOnce)(async (event) => { calls.push(BigInt(event.id)); });
    strict_1.default.equal(secondDrain.claimed, 0, 'a DELIVERED row must never be re-claimed by a later drain');
    strict_1.default.equal(calls.filter((c) => c === id).length, 1, 'the handler must have been invoked exactly once across both drains');
});
integration('a handler that always fails is retried with backoff and eventually becomes a visible POISON exception', async () => {
    const id = await insertPendingEvent();
    // The suite runs alongside other .postgres.test.ts files against the same
    // database (AGENTS.md's documented cross-test state-sharing caveat), so a
    // drain can also claim unrelated PENDING rows left by other suites in the
    // same batch. Only fail (and only count attempts) for this test's own
    // event id - anything else resolves successfully so it never pollutes
    // this test's attempt count or another suite's rows.
    let attempts = 0;
    for (let i = 0; i < outbox_worker_js_1.MAX_DELIVERY_ATTEMPTS; i += 1) {
        // Force availability immediately so the test does not wait out real backoff delays.
        await (0, db_js_1.executeRaw)(db_js_1.prisma, `UPDATE "DomainEventOutbox" SET "availableAt" = now() WHERE id = ? AND status = 'PENDING'`, id);
        const result = await (0, outbox_worker_js_1.drainOutboxOnce)(async (event) => {
            if (BigInt(event.id) !== id)
                return;
            attempts += 1;
            throw new Error('handler always fails');
        });
        if (result.poisoned > 0)
            break;
    }
    strict_1.default.equal(attempts, outbox_worker_js_1.MAX_DELIVERY_ATTEMPTS, 'the handler must be retried exactly MAX_DELIVERY_ATTEMPTS times before poisoning');
    const [row] = await db_js_1.prisma.$queryRawUnsafe(`SELECT status, "lastError" FROM "DomainEventOutbox" WHERE id = $1`, id);
    strict_1.default.equal(row.status, 'POISON');
    strict_1.default.match(row.lastError ?? '', /handler always fails/);
    const poisoned = await (0, outbox_worker_js_1.listPoisonEvents)();
    strict_1.default.ok(poisoned.some((p) => p.id === id), 'a poison event must be visible via listPoisonEvents, not silently dropped');
    await (0, outbox_worker_js_1.requeuePoisonEvent)(id);
    const [requeued] = await db_js_1.prisma.$queryRawUnsafe(`SELECT status, attempts FROM "DomainEventOutbox" WHERE id = $1`, id);
    strict_1.default.equal(requeued.status, 'PENDING');
    strict_1.default.equal(requeued.attempts, 0);
});
integration('one poison event does not block delivery of other pending events in the same batch', async () => {
    const poisonId = await insertPendingEvent();
    const goodId = await insertPendingEvent();
    const delivered = [];
    for (let i = 0; i < outbox_worker_js_1.MAX_DELIVERY_ATTEMPTS; i += 1) {
        await (0, db_js_1.executeRaw)(db_js_1.prisma, `UPDATE "DomainEventOutbox" SET "availableAt" = now() WHERE id = ? AND status = 'PENDING'`, poisonId);
        await (0, outbox_worker_js_1.drainOutboxOnce)(async (event) => {
            if (BigInt(event.id) === poisonId)
                throw new Error('always fails');
            delivered.push(BigInt(event.id));
        });
    }
    strict_1.default.ok(delivered.includes(goodId), 'the healthy event must still be delivered despite the poison event failing repeatedly');
    const [poisonRow] = await db_js_1.prisma.$queryRawUnsafe(`SELECT status FROM "DomainEventOutbox" WHERE id = $1`, poisonId);
    strict_1.default.equal(poisonRow.status, 'POISON');
});
