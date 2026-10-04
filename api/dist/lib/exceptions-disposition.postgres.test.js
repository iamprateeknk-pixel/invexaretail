"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 6: an exception disposition moves stock out of quarantine. Restock goes
// back on-hand through the canonical service; a write-off is a bucket move and
// must not change the on-hand journal sum. Skipped unless TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const exceptions_js_1 = require("./exceptions.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function setup() {
    const companyId = `exc-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `exc-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: 'E', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    const loc = await db_js_1.prisma.location.create({ data: { id: `exc-loc-${(0, node_crypto_1.randomUUID)()}`, code: `exc-${(0, node_crypto_1.randomUUID)()}`, name: 'L', type: 'store', companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `EXC-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'I', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: loc.id, onHand: 5, quarantine: 4, companyId } });
    const exceptionCase = await db_js_1.prisma.exceptionCase.create({
        data: { type: 'DAMAGE', title: 't', description: 'd', itemId: item.id, lotId: lot.id, locationId: loc.id, quantity: 3, reportedById: userId, companyId },
    });
    return { companyId, userId, loc, item, exceptionCase };
}
integration('RESTOCK moves quarantine back on-hand with one canonical journal row', async () => {
    const f = await setup();
    await (0, exceptions_js_1.applyExceptionDisposition)(f.exceptionCase, 'RESTOCK', f.userId);
    const ledger = await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
    strict_1.default.equal(ledger.onHand, 8);
    strict_1.default.equal(ledger.quarantine, 1);
    const rows = await db_js_1.prisma.stockMovement.findMany({ where: { itemId: f.item.id } });
    strict_1.default.equal(rows.length, 1);
    strict_1.default.equal(rows[0].qtyDelta, 3);
    strict_1.default.equal(rows[0].companyId, f.companyId);
});
integration('WRITE_OFF is a bucket move: damaged rises, on-hand is untouched, journal delta is zero', async () => {
    const f = await setup();
    await (0, exceptions_js_1.applyExceptionDisposition)(f.exceptionCase, 'WRITE_OFF', f.userId);
    const ledger = await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
    strict_1.default.equal(ledger.onHand, 5);
    strict_1.default.equal(ledger.quarantine, 1);
    strict_1.default.equal(ledger.damaged, 3);
    const rows = await db_js_1.prisma.stockMovement.findMany({ where: { itemId: f.item.id } });
    strict_1.default.equal(rows.length, 1);
    strict_1.default.equal(rows[0].qtyDelta, 0);
});
