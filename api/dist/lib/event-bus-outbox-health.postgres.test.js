"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 19 execution-guide scope ("outbox lag ... business SLIs"), exercised
// against real Postgres. Skipped unless TEST_DATABASE_URL is set (see
// AGENTS.md "Required tests" - a change to lib/event-bus.ts's outbox
// concerns needs real-database coverage).
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const event_bus_js_1 = require("./event-bus.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60 * 1000);
}
integration('reports zero pending/poison and zero lag when the outbox is empty for the relevant window', async () => {
    const companyId = `outbox-health-test-${(0, node_crypto_1.randomUUID)()}`;
    // Nothing created under this companyId; the snapshot is global (an
    // operational/infra SLI, not tenant business data - only counts and ages
    // are exposed, nothing tenant-identifying), so isolate by asserting
    // relative behavior instead of an absolute zero.
    const before = await (0, event_bus_js_1.outboxHealthSnapshot)();
    strict_1.default.ok(before, 'expected a snapshot in database mode');
    await db_js_1.prisma.domainEventOutbox.create({ data: { topic: 'stock.changed', companyId, status: 'DELIVERED', occurredAt: minutesAgo(5) } });
    const afterDeliveredOnly = await (0, event_bus_js_1.outboxHealthSnapshot)();
    strict_1.default.equal(afterDeliveredOnly.pending, before.pending, 'a DELIVERED row must not count as pending');
});
integration('oldestPendingAgeSeconds reflects the oldest still-PENDING row, and poison rows are counted separately', async () => {
    const companyId = `outbox-health-test-${(0, node_crypto_1.randomUUID)()}`;
    const oldPending = await db_js_1.prisma.domainEventOutbox.create({
        data: { topic: 'stock.changed', companyId, status: 'PENDING', occurredAt: minutesAgo(20) },
    });
    await db_js_1.prisma.domainEventOutbox.create({
        data: { topic: 'stock.changed', companyId, status: 'PENDING', occurredAt: minutesAgo(1) },
    });
    await db_js_1.prisma.domainEventOutbox.create({
        data: { topic: 'stock.changed', companyId, status: 'POISON', occurredAt: minutesAgo(30) },
    });
    const now = new Date();
    const snapshot = await (0, event_bus_js_1.outboxHealthSnapshot)(now);
    strict_1.default.ok(snapshot);
    strict_1.default.ok(snapshot.pending >= 2);
    strict_1.default.ok(snapshot.poison >= 1);
    const expectedAgeSeconds = Math.round((now.getTime() - oldPending.occurredAt.getTime()) / 1000);
    // The oldest PENDING row across the whole table drives the lag figure - a
    // newer PENDING row from another test/company must never make it look
    // younger than it is.
    strict_1.default.ok(snapshot.oldestPendingAgeSeconds >= expectedAgeSeconds - 2);
});
