"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bare-id call-site migration, slice 2 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the PurchaseOrder routes in
// routes/catalog-procurement.ts fixed to filter by companyId instead of
// looking a row up by bare id alone. DB-only - skipped unless
// TEST_DATABASE_URL is set. Reuses the withServer/makeFixture pattern from
// operations-extension-orders.postgres.test.ts (Order routes, slice 1).
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const catalog_procurement_js_1 = __importDefault(require("./catalog-procurement.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // catalogProcurementRouter applies its own extractToken/requireAuth
    // internally - no external auth middleware needed.
    app.use('/api/v1', catalog_procurement_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const call = async (method, path, token, body) => {
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
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
async function makeFixture() {
    const companyId = `catalog-po-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `catalog-po-user-${(0, node_crypto_1.randomUUID)()}`;
    // PurchaseOrder.createdById is a real FK to User.
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Catalog PO Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Catalog PO Test Admin',
        role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
    });
    const locationId = `catalog-po-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
    const supplier = await db_js_1.prisma.supplier.create({ data: { id: `catalog-po-supplier-${(0, node_crypto_1.randomUUID)()}`, name: 'Test Supplier' } });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    return { companyId, userId, locationId, supplierId: supplier.id, token };
}
async function makePo(companyId, locationId, supplierId, createdById) {
    return db_js_1.prisma.purchaseOrder.create({
        data: { number: `PO-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, supplierId, locationId, createdById, companyId, status: 'DRAFT' },
    });
}
integration('GET /purchase-orders only ever returns the caller\'s own company\'s purchase orders', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const poA = await makePo(a.companyId, a.locationId, a.supplierId, a.userId);
    const poB = await makePo(b.companyId, b.locationId, b.supplierId, b.userId);
    await withServer(async (call) => {
        const listA = await call('GET', '/purchase-orders', a.token);
        strict_1.default.equal(listA.status, 200);
        const idsA = listA.body.purchaseOrders.map((po) => po.id);
        strict_1.default.ok(idsA.includes(poA.id), 'company A must see its own purchase order');
        strict_1.default.ok(!idsA.includes(poB.id), 'company A must not see company B\'s purchase order');
    });
});
integration('PATCH /purchase-orders/:id/status: another company\'s purchase order id resolves 404, not a status change', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const poA = await makePo(a.companyId, a.locationId, a.supplierId, a.userId);
    await withServer(async (call) => {
        const cross = await call('PATCH', `/purchase-orders/${poA.id}/status`, b.token, { status: 'CANCELLED' });
        strict_1.default.equal(cross.status, 404, 'a real purchase order belonging to another company must look identical to a missing one');
        const unchanged = await db_js_1.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poA.id } });
        strict_1.default.equal(unchanged.status, 'DRAFT', 'the cross-tenant attempt must not have changed anything');
        const own = await call('PATCH', `/purchase-orders/${poA.id}/status`, a.token, { status: 'CANCELLED' });
        strict_1.default.equal(own.status, 200, JSON.stringify(own.body));
        strict_1.default.equal((await db_js_1.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poA.id } })).status, 'CANCELLED');
    });
});
integration('GET /purchase-orders/:id/invoices: another company\'s purchase order id returns no invoices, not a leak through the join', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const poA = await makePo(a.companyId, a.locationId, a.supplierId, a.userId);
    await db_js_1.prisma.supplierInvoice.create({
        data: { purchaseOrderId: poA.id, invoiceNumber: `INV-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, createdById: a.userId },
    });
    await withServer(async (call) => {
        const cross = await call('GET', `/purchase-orders/${poA.id}/invoices`, b.token);
        strict_1.default.equal(cross.status, 200);
        strict_1.default.deepEqual(cross.body.invoices, [], 'another company must not see invoices for a purchase order it does not own');
        const own = await call('GET', `/purchase-orders/${poA.id}/invoices`, a.token);
        strict_1.default.equal(own.status, 200);
        strict_1.default.equal(own.body.invoices.length, 1);
    });
});
integration('POST /purchase-orders/:id/receive: another company\'s purchase order id resolves 404', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const poA = await makePo(a.companyId, a.locationId, a.supplierId, a.userId);
    await withServer(async (call) => {
        const cross = await call('POST', `/purchase-orders/${poA.id}/receive`, b.token, { requestId: (0, node_crypto_1.randomUUID)(), lines: [] });
        strict_1.default.equal(cross.status, 404);
    });
});
// Week 6 / guide Week 14: PO receipt posts its sellable quantity through the
// canonical posting service *inside the receipt transaction*. Before, the
// StockMovement journal row was written after commit and its failure was
// swallowed, so the journal could silently disagree with the ledger.
integration('POST /purchase-orders/:id/receive posts a journal row atomically with the ledger, once per requestId', async () => {
    const a = await makeFixture();
    const item = await db_js_1.prisma.item.create({ data: { code: `CANON-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Canonical Rice', companyId: a.companyId } });
    const po = await db_js_1.prisma.purchaseOrder.create({
        data: { number: `PO-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, supplierId: a.supplierId, locationId: a.locationId, createdById: a.userId, companyId: a.companyId, status: 'APPROVED',
            lines: { create: [{ itemId: item.id, quantity: 20, unitCost: 5 }] } },
        include: { lines: true },
    });
    const requestId = (0, node_crypto_1.randomUUID)();
    await withServer(async (call) => {
        const body = { requestId, lines: [{ lineId: po.lines[0].id, receivedQty: 8, damagedQty: 2, excessQty: 0, lotNo: 'CANON-LOT' }] };
        const first = await call('POST', `/purchase-orders/${po.id}/receive`, a.token, body);
        strict_1.default.equal(first.status, 200, JSON.stringify(first.body));
        strict_1.default.equal(first.body.duplicate, false);
        const retry = await call('POST', `/purchase-orders/${po.id}/receive`, a.token, body);
        strict_1.default.equal(retry.body.duplicate, true);
    });
    const ledger = await db_js_1.prisma.stockLedger.findMany({ where: { itemId: item.id, locationId: a.locationId } });
    strict_1.default.equal(ledger.length, 1);
    strict_1.default.equal(ledger[0].onHand, 8, 'sellable quantity only');
    strict_1.default.equal(ledger[0].quarantine, 2, 'damaged quantity is quarantined, not sellable');
    strict_1.default.equal(ledger[0].companyId, a.companyId);
    const movements = await db_js_1.prisma.stockMovement.findMany({ where: { itemId: item.id, locationId: a.locationId } });
    strict_1.default.equal(movements.length, 1, 'exactly one journal row despite the retried request');
    strict_1.default.equal(movements[0].qtyDelta, 8);
    strict_1.default.equal(movements[0].afterBalance, 8);
    strict_1.default.equal(movements[0].companyId, a.companyId);
    strict_1.default.equal(movements.reduce((sum, m) => sum + m.qtyDelta, 0), ledger[0].onHand, 'journal sum equals the projection');
});
integration('a failing receipt leaves neither a journal row nor a ledger change (atomic)', async () => {
    const a = await makeFixture();
    const item = await db_js_1.prisma.item.create({ data: { code: `CANON-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Atomic Rice', companyId: a.companyId } });
    const po = await db_js_1.prisma.purchaseOrder.create({
        data: { number: `PO-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, supplierId: a.supplierId, locationId: a.locationId, createdById: a.userId, companyId: a.companyId, status: 'APPROVED',
            lines: { create: [{ itemId: item.id, quantity: 10, unitCost: 5 }] } },
        include: { lines: true },
    });
    // Pre-existing lot with a different expiry makes the transaction throw *after* the line update.
    await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'CLASH', expiryDate: new Date('2027-01-01') } });
    await withServer(async (call) => {
        const res = await call('POST', `/purchase-orders/${po.id}/receive`, a.token, {
            requestId: (0, node_crypto_1.randomUUID)(), lines: [{ lineId: po.lines[0].id, receivedQty: 5, damagedQty: 0, excessQty: 0, lotNo: 'CLASH', expiryDate: '2028-02-02' }],
        });
        strict_1.default.equal(res.status, 400);
    });
    strict_1.default.equal(await db_js_1.prisma.stockMovement.count({ where: { itemId: item.id } }), 0);
    strict_1.default.equal(await db_js_1.prisma.stockLedger.count({ where: { itemId: item.id } }), 0);
    strict_1.default.equal((await db_js_1.prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } })).receivedQty, 0);
});
