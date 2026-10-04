"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 6 / guide Week 15: order fulfilment deducts onHand through the
// canonical service in the fulfilment transaction (journal + ledger together)
// and releases the reservation; a second fulfil cannot deduct again. Skipped
// unless TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const orders_js_1 = require("./orders.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
integration('fulfillOrder posts a SALES_DEDUCTION journal row, releases the reservation, and cannot deduct twice', async () => {
    const companyId = `ord-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `ord-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: 'O', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    const loc = await db_js_1.prisma.location.create({ data: { id: `ord-loc-${(0, node_crypto_1.randomUUID)()}`, code: `ord-${(0, node_crypto_1.randomUUID)()}`, name: 'L', type: 'warehouse', companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `ORD-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'I', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: loc.id, onHand: 10, reserved: 3, companyId } });
    const order = await db_js_1.prisma.order.create({
        data: { channel: 'WEBSITE', status: 'RESERVED', fulfillmentLocationId: loc.id, createdById: userId, companyId,
            lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: 3, fulfillmentLocationId: loc.id }] } },
    });
    const otherCompanyId = `ord-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: otherCompanyId, name: otherCompanyId } });
    const otherUserId = `ord-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: otherUserId, name: 'Other', email: `${otherUserId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId: otherCompanyId } });
    await strict_1.default.rejects((0, orders_js_1.fulfillOrder)(otherCompanyId, order.id, otherUserId), /not found/i);
    strict_1.default.equal((await db_js_1.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'RESERVED', 'a cross-tenant attempt must not mutate the order');
    await (0, orders_js_1.fulfillOrder)(companyId, order.id, userId);
    const ledger = await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: loc.id } });
    strict_1.default.equal(ledger.onHand, 7);
    strict_1.default.equal(ledger.reserved, 0);
    const rows = await db_js_1.prisma.stockMovement.findMany({ where: { itemId: item.id } });
    strict_1.default.equal(rows.length, 1);
    strict_1.default.equal(rows[0].movementType, 'SALES_DEDUCTION');
    strict_1.default.equal(rows[0].qtyDelta, -3);
    strict_1.default.equal(rows[0].companyId, companyId);
    await strict_1.default.rejects((0, orders_js_1.fulfillOrder)(companyId, order.id, userId), 'a fulfilled order cannot be fulfilled again');
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: loc.id } })).onHand, 7);
    strict_1.default.equal(await db_js_1.prisma.stockMovement.count({ where: { itemId: item.id } }), 1);
});
