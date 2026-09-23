"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 14: DomainEventOutbox retention pruning, exercised against real
// Postgres. Skipped unless TEST_DATABASE_URL is set (see AGENTS.md
// "Required tests").
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const event_bus_js_1 = require("./event-bus.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
function daysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
integration('prunes rows older than the retention window and leaves recent rows untouched', async () => {
    const companyId = `outbox-retention-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.domainEventOutbox.create({
        data: { topic: 'stock.changed', companyId, occurredAt: daysAgo(event_bus_js_1.OUTBOX_RETENTION_DAYS + 1) },
    });
    const recent = await db_js_1.prisma.domainEventOutbox.create({
        data: { topic: 'stock.changed', companyId, occurredAt: daysAgo(1) },
    });
    const removed = await (0, event_bus_js_1.pruneDomainEventOutbox)();
    strict_1.default.ok(removed >= 1);
    const remaining = await db_js_1.prisma.domainEventOutbox.findMany({ where: { companyId } });
    strict_1.default.equal(remaining.length, 1);
    strict_1.default.equal(remaining[0].id, recent.id);
});
integration('a client reconnecting within the retention window can still replay through durableEventsSince', async () => {
    const companyId = `outbox-retention-test-${(0, node_crypto_1.randomUUID)()}`;
    const before = await db_js_1.prisma.domainEventOutbox.create({
        data: { topic: 'stock.changed', companyId, occurredAt: daysAgo(1) },
    });
    const after = await db_js_1.prisma.domainEventOutbox.create({
        data: { topic: 'item.changed', companyId, occurredAt: daysAgo(0.5) },
    });
    await (0, event_bus_js_1.pruneDomainEventOutbox)();
    const events = await (0, event_bus_js_1.durableEventsSince)(Number(before.id) - 1, { companyId, locationIds: null });
    const ids = events.map((e) => e.id).sort((a, b) => a - b);
    strict_1.default.deepEqual(ids, [Number(before.id), Number(after.id)]);
});
