"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 7 mandatory verification: "Two concurrent users cannot reserve more
// than available stock." Exercised against real Postgres, not the
// in-memory test mode - see AGENTS.md "Required tests". Skipped unless
// TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const reservation_js_1 = require("./reservation.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function makeFixture(onHand) {
    const companyId = `reservation-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const locationId = `reservation-test-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
    const itemId = `reservation-test-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Reservation Test Item', unit: 'ea', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand, companyId } });
    return { companyId, locationId, itemId, lotId: lot.id };
}
integration('two concurrent reservations for the same lot cannot together exceed on-hand stock', async () => {
    const { locationId, itemId, lotId } = await makeFixture(10);
    // Both requests ask for 7 of a 10-unit lot: sequentially only one can
    // succeed. This is the exact defect class the Week 6 read-then-write
    // version of this function had - see reservation.ts's Week 7 comment.
    const attempt = () => (0, reservation_js_1.reserveStockForTransfer)([{ itemId, lotId, locationId, quantity: 7 }]);
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    strict_1.default.equal(fulfilled.length, 1, 'exactly one of the two concurrent reservations must succeed');
    strict_1.default.equal(rejected.length, 1, 'exactly one of the two concurrent reservations must be rejected');
    strict_1.default.ok(rejected[0].reason instanceof reservation_js_1.InsufficientStockError, 'the losing request must fail with the stable InsufficientStockError, not a generic error or a silent partial reservation');
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    strict_1.default.equal(ledger?.reserved, 7, 'reserved must reflect exactly one successful reservation, never both (which would oversubscribe 14 > 10)');
});
integration('ten concurrent reservations against exactly enough stock for five never oversubscribe', async () => {
    const { locationId, itemId, lotId } = await makeFixture(5);
    const attempts = Array.from({ length: 10 }, () => (0, reservation_js_1.reserveStockForTransfer)([{ itemId, lotId, locationId, quantity: 1 }]));
    const results = await Promise.allSettled(attempts);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    strict_1.default.equal(succeeded, 5, 'exactly 5 of the 10 concurrent 1-unit requests can succeed against 5 units on hand');
    strict_1.default.equal(failed, 5);
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    strict_1.default.equal(ledger?.reserved, 5, 'SQL evidence: reserved never exceeds onHand even under concurrent load');
    strict_1.default.ok(ledger.reserved <= ledger.onHand, 'available stock must never become oversubscribed');
});
integration('a multi-line reservation is all-or-nothing: a shortfall on one line rolls back lines already reserved in the same call', async () => {
    const a = await makeFixture(10);
    const b = await makeFixture(2);
    await strict_1.default.rejects(() => (0, reservation_js_1.reserveStockForTransfer)([
        { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, quantity: 5 },
        { itemId: b.itemId, lotId: b.lotId, locationId: b.locationId, quantity: 5 },
    ]), reservation_js_1.InsufficientStockError);
    const ledgerA = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId } } });
    strict_1.default.equal(ledgerA?.reserved, 0, 'line A must not stay reserved when line B in the same call fails - no partial writes');
});
integration('releasing reserved stock never drives reserved below zero even when released twice', async () => {
    const { locationId, itemId, lotId } = await makeFixture(10);
    await (0, reservation_js_1.reserveStockForTransfer)([{ itemId, lotId, locationId, quantity: 4 }]);
    await (0, reservation_js_1.releaseReservedStock)([{ itemId, lotId, locationId, quantity: 4 }]);
    await (0, reservation_js_1.releaseReservedStock)([{ itemId, lotId, locationId, quantity: 4 }]);
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    strict_1.default.equal(ledger?.reserved, 0);
});
integration('reserving against a lot with no StockLedger row at all fails closed instead of reserving negative availability', async () => {
    const companyId = `reservation-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const locationId = `reservation-test-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
    const itemId = `reservation-test-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    await strict_1.default.rejects(() => (0, reservation_js_1.reserveStockForTransfer)([{ itemId, lotId: lot.id, locationId, quantity: 1 }]), reservation_js_1.InsufficientStockError);
});
