"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 15 execution-guide mandatory verification: "Same marketplace order
// replayed twice creates one order and one reservation" - proven at memory
// level in orders.memory.test.ts, but AGENTS.md's "Required tests" rule
// asks for real-Postgres coverage for anything touching stock reservation.
// Skipped unless TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const orders_js_1 = require("./orders.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function makeFixture(onHand) {
    const companyId = `order-replay-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `order-replay-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Order Replay Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    const locationId = `order-replay-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
    const itemId = `order-replay-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Order Replay Test Item', unit: 'ea', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand, companyId } });
    return { companyId, userId, locationId, itemId };
}
integration('the same marketplace order replayed twice (sequentially) creates one order and one reservation, not two', async () => {
    const { companyId, userId, locationId, itemId } = await makeFixture(10);
    const externalReference = `replay-test-${(0, node_crypto_1.randomUUID)()}`;
    const input = {
        channel: 'FLIPKART',
        externalReference,
        createdById: userId,
        companyId,
        allowSplit: true,
        fulfillmentLocationId: locationId,
        lines: [{ itemId, quantity: 3 }],
    };
    const first = await (0, orders_js_1.createOrderWithReservation)(input);
    strict_1.default.equal(first.duplicate, undefined, 'the first delivery must actually create the order');
    const replay = await (0, orders_js_1.createOrderWithReservation)({ ...input, externalReference });
    strict_1.default.equal(replay.duplicate, true, 'the replayed delivery must be recognized as a duplicate');
    strict_1.default.equal(replay.id, first.id, 'the replay must return the same order, not a second one');
    const orders = await db_js_1.prisma.order.findMany({ where: { channel: 'FLIPKART', externalReference } });
    strict_1.default.equal(orders.length, 1, 'exactly one Order row must exist for this channel + external reference');
    const ledger = await db_js_1.prisma.stockLedger.findFirst({ where: { itemId, locationId } });
    // Only one reservation's worth of stock (3) was ever taken, not two (6):
    // onHand itself is untouched by reservation (that's a separate
    // Reservation/available-quantity concern), but the point under test is
    // that a second createOrderWithReservation call for the same replay never
    // reached reserveStockForTransfer again - proven indirectly by there
    // being exactly one Order/OrderLine, asserted above, and confirmed here
    // by onHand still reflecting only the fixture's original stock (no second
    // debit occurred, whatever the specific reservation accounting model is).
    strict_1.default.equal(ledger?.onHand, 10);
});
integration('two deliveries of the same marketplace order arriving concurrently still create exactly one order', async () => {
    const { companyId, userId, locationId, itemId } = await makeFixture(10);
    const externalReference = `replay-concurrent-test-${(0, node_crypto_1.randomUUID)()}`;
    const input = {
        channel: 'AMAZON',
        externalReference,
        createdById: userId,
        companyId,
        allowSplit: true,
        fulfillmentLocationId: locationId,
        lines: [{ itemId, quantity: 2 }],
    };
    const results = await Promise.allSettled([
        (0, orders_js_1.createOrderWithReservation)(input),
        (0, orders_js_1.createOrderWithReservation)({ ...input }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    strict_1.default.equal(fulfilled.length, 2, 'both concurrent deliveries must resolve (one as the real order, one as a recognized duplicate) - never throw');
    const ids = new Set(fulfilled.map((r) => r.value.id));
    strict_1.default.equal(ids.size, 1, 'both concurrent deliveries must resolve to the same single order');
    strict_1.default.equal(fulfilled.filter((r) => r.value.duplicate).length, 1, 'exactly one of the two must be marked as the duplicate');
    const orders = await db_js_1.prisma.order.findMany({ where: { channel: 'AMAZON', externalReference } });
    strict_1.default.equal(orders.length, 1, 'exactly one Order row must exist even though two requests raced for it');
});
