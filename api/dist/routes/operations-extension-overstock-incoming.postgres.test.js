"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Audit R-1: overstock/network-need recommendations used to compare each network location's
// on-hand against its minimum with no regard for stock already on its way there - so a needy
// store with a transfer already dispatched to it still got recommended a second one. Proves
// GET /intelligence/:locationId now reduces (and, when fully covered, drops) a needy location's
// recommended transfer by what is already DISPATCHED/IN_TRANSIT/PARTIAL_RECEIVED to it, company
// wide, not just what is inbound to the location being viewed. DB-only - skipped unless
// TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const operations_extension_js_1 = __importDefault(require("./operations-extension.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', operations_extension_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const call = async (method, path, token) => {
        const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
        return { status: response.status, body: (await response.json().catch(() => ({}))) };
    };
    try {
        await run(call);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
integration("a needy store's overstock-transfer recommendation is reduced by stock already dispatched to it, and dropped once fully covered", async () => {
    const companyId = `ops-oi-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `ops-oi-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: 'A', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    (0, enterprise_repository_js_1.createEnhancedUser)({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'A', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    const donor = await db_js_1.prisma.location.create({ data: { code: `oi-donor-${(0, node_crypto_1.randomUUID)()}`, name: 'Donor WH', type: 'warehouse', companyId } });
    const needy = await db_js_1.prisma.location.create({ data: { code: `oi-needy-${(0, node_crypto_1.randomUUID)()}`, name: 'Needy Store', type: 'store', companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `OI-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Overstocked item', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    // Donor's own reorder rule (minQty/targetQty here double as the network-wide threshold this
    // endpoint's overstock rows are built against - see the comment above buildOverstockRecommendations).
    await db_js_1.prisma.reorderRule.create({ data: { itemId: item.id, locationId: donor.id, minQty: 10, targetQty: 20, companyId } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: donor.id, onHand: 100, companyId } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: needy.id, onHand: 0, companyId } });
    const findRec = (body) => body.intelligence.overstock.find((row) => row.itemId === item.id && row.destinationLocationId === needy.id);
    await withServer(async (call) => {
        const before = await call('GET', `/intelligence/${donor.id}`, token);
        strict_1.default.equal(before.status, 200, JSON.stringify(before.body));
        const recBefore = findRec(before.body);
        strict_1.default.ok(recBefore, 'with nothing in transit, the needy store must be recommended a transfer');
        strict_1.default.equal(recBefore.suggestedTransferQty, 10, 'need = minQty(10) - onHand(0)');
        // A transfer for the full need is already on its way to the needy store.
        await db_js_1.prisma.transfer.create({
            data: {
                sourceLocationId: donor.id, destinationLocationId: needy.id, requestedById: userId,
                status: 'DISPATCHED', companyId,
                lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: 10, receivedQty: 0 }] },
            },
        });
        const after = await call('GET', `/intelligence/${donor.id}`, token);
        strict_1.default.equal(after.status, 200, JSON.stringify(after.body));
        strict_1.default.equal(findRec(after.body), undefined, 'need is already fully covered by the in-flight transfer: no duplicate recommendation');
    });
});
integration("an expiring lot is suggested as a TRANSFER to a genuinely faster-selling branch, not just MARKDOWN (audit R-1)", async () => {
    const companyId = `ops-xt-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `ops-xt-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: 'A', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    (0, enterprise_repository_js_1.createEnhancedUser)({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'A', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    const slow = await db_js_1.prisma.location.create({ data: { code: `xt-slow-${(0, node_crypto_1.randomUUID)()}`, name: 'Slow Store', type: 'store', companyId } });
    const fast = await db_js_1.prisma.location.create({ data: { code: `xt-fast-${(0, node_crypto_1.randomUUID)()}`, name: 'Fast Store', type: 'store', companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `XT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Expiring item', companyId } });
    const day = 86_400_000;
    const expiringLot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-EXP-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`, expiryDate: new Date(Date.now() + 10 * day) } });
    const fastLot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-FAST-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: expiringLot.id, locationId: slow.id, onHand: 100, companyId } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: fastLot.id, locationId: fast.id, onHand: 20, companyId } });
    // Slow store: 1 unit/day. Fast store: 5 units/day - genuinely faster.
    const sale = (locationId, lotId, daysAgo, qty) => db_js_1.prisma.stockMovement.create({ data: { itemId: item.id, lotId, locationId, movementType: 'SALES_DEDUCTION', qtyDelta: -qty, beforeBalance: qty, afterBalance: 0, actor: userId, timestamp: new Date(Date.now() - daysAgo * day), companyId } });
    for (let d = 1; d <= 20; d += 1)
        await sale(slow.id, expiringLot.id, d, 1);
    for (let d = 1; d <= 20; d += 1)
        await sale(fast.id, fastLot.id, d, 5);
    await withServer(async (call) => {
        const res = await call('GET', `/intelligence/${slow.id}`, token);
        strict_1.default.equal(res.status, 200, JSON.stringify(res.body));
        const rec = res.body.intelligence.expiryActions.find((row) => row.itemId === item.id);
        strict_1.default.ok(rec, 'the expiring lot must produce a recommendation');
        strict_1.default.equal(rec.suggestedAction, 'TRANSFER', `expected TRANSFER to the faster branch, got ${JSON.stringify(rec)}`);
        strict_1.default.equal(rec.destinationLocationId, fast.id);
        strict_1.default.ok(rec.suggestedTransferQty > 0);
    });
});
