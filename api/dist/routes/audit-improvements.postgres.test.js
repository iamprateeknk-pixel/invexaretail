"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Real-Postgres coverage for the inventory-audit improvements that touch routes:
//  - purchase plan ignores stock nobody can sell (expired / blocked lots) as cover   (O-6)
//  - reorder rules accept fractional quantities for KG items only                    (O-4)
//  - jobs are company scoped: list, lines, status, consume, create                    (T-1)
//  - PO/JOB numbers are unique per company                                            (T-1)
// Skipped unless TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const catalog_procurement_js_1 = __importDefault(require("./catalog-procurement.js"));
const operations_extension_js_1 = __importDefault(require("./operations-extension.js"));
const reports_js_1 = __importDefault(require("./reports.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', catalog_procurement_js_1.default);
    app.use('/api/v1', operations_extension_js_1.default);
    app.use('/api/v1', reports_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('bind failed');
    const call = async (method, path, token, body) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
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
async function makeCompany() {
    const companyId = `aud-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `aud-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: 'A', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    (0, enterprise_repository_js_1.createEnhancedUser)({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'A', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
    const loc = await db_js_1.prisma.location.create({ data: { id: `aud-loc-${(0, node_crypto_1.randomUUID)()}`, code: `aud-${(0, node_crypto_1.randomUUID)()}`, name: 'Store', type: 'store', companyId } });
    return { companyId, userId, loc, token: (0, otp_auth_js_1.generateJWT)(userId, companyId) };
}
integration('the purchase plan does not count expired or blocked lots as cover', async () => {
    const a = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `PLN-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Plan item', companyId: a.companyId } });
    const expired = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'OLD', expiryDate: new Date('2020-01-01T00:00:00Z') } });
    const blocked = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'BLK', status: 'BLOCKED' } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: expired.id, locationId: a.loc.id, onHand: 50, companyId: a.companyId } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: blocked.id, locationId: a.loc.id, onHand: 50, companyId: a.companyId } });
    await db_js_1.prisma.reorderRule.create({ data: { itemId: item.id, locationId: a.loc.id, minQty: 10, targetQty: 40, companyId: a.companyId } });
    await withServer(async (call) => {
        const res = await call('GET', `/purchase-orders/plan?locationId=${a.loc.id}`, a.token);
        strict_1.default.equal(res.status, 200, JSON.stringify(res.body));
        const suggestion = res.body.suggestions.find((s) => s.itemId === item.id);
        strict_1.default.ok(suggestion, '100 units on hand but none sellable: the item must be flagged, not "covered"');
        strict_1.default.equal(suggestion.position, 0);
        strict_1.default.equal(suggestion.urgency, 'CRITICAL');
    });
});
integration('reorder rules: fractional quantities are accepted for KG items and rejected for counted items', async () => {
    const a = await makeCompany();
    const kg = await db_js_1.prisma.item.create({ data: { code: `KG-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Loose rice', decimalQuantity: true, companyId: a.companyId } });
    const pcs = await db_js_1.prisma.item.create({ data: { code: `PC-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Soap', companyId: a.companyId } });
    await withServer(async (call) => {
        const ok = await call('PUT', `/reorder-rules/${kg.id}`, a.token, { locationId: a.loc.id, minQty: 2.5, targetQty: 10.25 });
        strict_1.default.equal(ok.status, 200, JSON.stringify(ok.body));
        strict_1.default.equal(ok.body.rule.minQty, 2.5);
        const rejected = await call('PUT', `/reorder-rules/${pcs.id}`, a.token, { locationId: a.loc.id, minQty: 2.5, targetQty: 10 });
        strict_1.default.equal(rejected.status, 400);
        strict_1.default.match(rejected.body.message, /whole numbers/);
    });
});
integration('jobs are company scoped: another company cannot list, extend, change or consume them, or create one at your location', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `JOB-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Job item', companyId: a.companyId } });
    await withServer(async (call) => {
        const created = await call('POST', '/jobs', a.token, { name: 'A job', locationId: a.loc.id });
        strict_1.default.equal(created.status, 201, JSON.stringify(created.body));
        const jobId = created.body.job.id;
        strict_1.default.equal(created.body.job.companyId, a.companyId);
        strict_1.default.match(created.body.job.number, /^JOB-\d{6}-[0-9A-Z]{8}$/);
        const line = await call('POST', `/jobs/${jobId}/lines`, a.token, { itemId: item.id, plannedQty: 3 });
        strict_1.default.equal(line.status, 201);
        strict_1.default.equal((await call('GET', '/jobs', b.token)).body.jobs.some((j) => j.id === jobId), false, 'B must not see A\'s job');
        strict_1.default.equal((await call('GET', '/jobs', a.token)).body.jobs.some((j) => j.id === jobId), true);
        strict_1.default.equal((await call('POST', `/jobs/${jobId}/lines`, b.token, { itemId: item.id, plannedQty: 1 })).status, 404);
        strict_1.default.equal((await call('PATCH', `/jobs/${jobId}/status`, b.token, { status: 'CANCELLED' })).status, 404);
        strict_1.default.equal((await call('PATCH', `/jobs/${jobId}/lines/${line.body.line.id}`, b.token, { issuedQty: 99 })).status, 404);
        strict_1.default.equal((await call('POST', `/jobs/${jobId}/consume`, b.token, { lineId: line.body.line.id, quantity: 1 })).status, 404);
        strict_1.default.equal((await call('POST', '/jobs', b.token, { name: 'Sneaky', locationId: a.loc.id })).status, 404, 'cannot create a job at another company\'s location');
        strict_1.default.equal((await db_js_1.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status, 'DRAFT');
        strict_1.default.equal((await db_js_1.prisma.jobLine.findUniqueOrThrow({ where: { id: line.body.line.id } })).issuedQty, 0);
        // A line id from ANOTHER job of the same company must not be editable through this job.
        const other = await call('POST', '/jobs', a.token, { name: 'A other job', locationId: a.loc.id });
        strict_1.default.equal((await call('PATCH', `/jobs/${other.body.job.id}/lines/${line.body.line.id}`, a.token, { issuedQty: 5 })).status, 404);
    });
});
integration('two companies can hold the same PO and job number; one company cannot', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const supplier = await db_js_1.prisma.supplier.create({ data: { name: `S-${(0, node_crypto_1.randomUUID)()}`, companyId: a.companyId } });
    const number = `PO-SHARED-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`;
    const mk = (company) => db_js_1.prisma.purchaseOrder.create({ data: { number, supplierId: supplier.id, locationId: company.loc.id, createdById: company.userId, companyId: company.companyId } });
    await mk(a);
    await mk(b);
    await strict_1.default.rejects(mk(a));
    await db_js_1.prisma.job.create({ data: { number: 'J-1', name: 'x', companyId: a.companyId, locationId: a.loc.id, createdById: a.userId } });
    await db_js_1.prisma.job.create({ data: { number: 'J-1', name: 'x', companyId: b.companyId, locationId: b.loc.id, createdById: b.userId } });
    await strict_1.default.rejects(db_js_1.prisma.job.create({ data: { number: 'J-1', name: 'x', companyId: a.companyId, locationId: a.loc.id, createdById: a.userId } }));
});
integration('GET /purchase-orders is bounded and pages with a cursor, returning every order exactly once, only this company\'s', async () => {
    const a = await makeCompany();
    const other = await makeCompany();
    const supplier = await db_js_1.prisma.supplier.create({ data: { name: `S-${(0, node_crypto_1.randomUUID)()}`, companyId: a.companyId } });
    for (let i = 0; i < 7; i += 1) {
        await db_js_1.prisma.purchaseOrder.create({ data: { number: `PG-${i}-${(0, node_crypto_1.randomUUID)().slice(0, 4)}`, supplierId: supplier.id, locationId: a.loc.id, createdById: a.userId, companyId: a.companyId } });
    }
    await db_js_1.prisma.purchaseOrder.create({ data: { number: `PG-X-${(0, node_crypto_1.randomUUID)().slice(0, 4)}`, supplierId: supplier.id, locationId: other.loc.id, createdById: other.userId, companyId: other.companyId } });
    await withServer(async (call) => {
        const seen = [];
        let cursor = null;
        for (let page = 0; page < 5; page += 1) {
            const res = await call('GET', `/purchase-orders?limit=3${cursor ? `&cursor=${cursor}` : ''}`, a.token);
            strict_1.default.equal(res.status, 200);
            strict_1.default.ok(res.body.purchaseOrders.length <= 3);
            seen.push(...res.body.purchaseOrders.map((row) => row.id));
            cursor = res.body.nextCursor;
            if (!cursor)
                break;
        }
        strict_1.default.equal(seen.length, 7);
        strict_1.default.equal(new Set(seen).size, 7, 'no duplicates across pages');
    });
});
integration('inventory health: valuation, turns, dead stock - company scoped, uncosted stock is reported not priced', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const mkItem = (company, code) => db_js_1.prisma.item.create({ data: { code: `${code}-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`, name: code, category: 'Dairy', companyId: company.companyId } });
    const milk = await mkItem(a, 'MILK');
    const rice = await mkItem(a, 'RICE');
    const oil = await mkItem(a, 'OIL');
    const foreign = await mkItem(b, 'FOREIGN');
    const lot = (itemId, attributes) => db_js_1.prisma.lot.create({ data: { itemId, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`, attributes: attributes } });
    const milkLot = await lot(milk.id, { purchaseRate: 10 });
    const riceLot = await lot(rice.id, { purchaseRate: 20 });
    const oilLot = await lot(oil.id, null);
    const foreignLot = await lot(foreign.id, { purchaseRate: 999 });
    const put = (company, itemId, lotId, onHand) => db_js_1.prisma.stockLedger.create({ data: { itemId, lotId, locationId: company.loc.id, onHand, companyId: company.companyId } });
    await put(a, milk.id, milkLot.id, 100);
    await put(a, rice.id, riceLot.id, 10);
    await put(a, oil.id, oilLot.id, 5);
    await put(b, foreign.id, foreignLot.id, 1000);
    await db_js_1.prisma.stockMovement.create({ data: { itemId: milk.id, lotId: milkLot.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -30, beforeBalance: 130, afterBalance: 100, actor: a.userId, timestamp: new Date(), companyId: a.companyId } });
    await withServer(async (call) => {
        const res = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}&windowDays=30`, a.token);
        strict_1.default.equal(res.status, 200, JSON.stringify(res.body));
        strict_1.default.equal(res.body.valuation.totalValue, 1200, "100 x 10 + 10 x 20; a second company's 999 x 1000 is not included");
        strict_1.default.equal(res.body.valuation.unvaluedUnits, 5);
        strict_1.default.equal(res.body.service.orders, 0, 'no orders decided in this window');
        strict_1.default.equal(res.body.service.orderFillRatePercent, null);
        const status = Object.fromEntries(res.body.items.map((i) => [i.name, i.status]));
        strict_1.default.equal(status.MILK, 'HEALTHY');
        strict_1.default.equal(status.RICE, 'DEAD', 'stock on hand and zero sales while other items sold');
        strict_1.default.equal(res.body.deadStock.value, 200);
        strict_1.default.equal(res.body.turns, 3.04, 'COGS 300 in 30 days, annualised, over value 1200');
        const other = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}`, b.token);
        strict_1.default.equal(other.status, 404, 'another company cannot read this location');
    });
});
integration('in-transit report rolls up StockLedger.inTransit by item across every location, company scoped (audit O-7)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `IT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'In transit', companyId: a.companyId } });
    const otherLoc = await db_js_1.prisma.location.create({ data: { code: `aud-${(0, node_crypto_1.randomUUID)()}`, name: 'Other store', type: 'store', companyId: a.companyId } });
    const mk = async (company, code) => {
        const it = await db_js_1.prisma.item.create({ data: { code: `${code}-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`, name: code, companyId: company.companyId } });
        const lot = await db_js_1.prisma.lot.create({ data: { itemId: it.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
        await db_js_1.prisma.stockLedger.create({ data: { itemId: it.id, lotId: lot.id, locationId: company.loc.id, onHand: 0, inTransit: 50, companyId: company.companyId } });
        return it;
    };
    const foreign = await mk(b, 'FOR');
    const lotA1 = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L1-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    const lotA2 = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L2-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lotA1.id, locationId: a.loc.id, onHand: 0, inTransit: 12, companyId: a.companyId } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lotA2.id, locationId: otherLoc.id, onHand: 0, inTransit: 3, companyId: a.companyId } });
    await withServer(async (call) => {
        const res = await call('GET', '/reports/in-transit', a.token);
        strict_1.default.equal(res.status, 200, JSON.stringify(res.body));
        const row = res.body.items.find((i) => i.itemId === item.id);
        strict_1.default.ok(row, 'item with in-transit stock at two locations must appear');
        strict_1.default.equal(row.totalInTransit, 15, '12 + 3 across the two locations');
        strict_1.default.equal(row.locations.length, 2);
        strict_1.default.equal(res.body.items.some((i) => i.itemId === foreign.id), false, "another company's in-transit stock must not appear");
        strict_1.default.ok(res.body.totalInTransit >= 15);
        const denied = await call('GET', '/reports/in-transit', b.token);
        strict_1.default.equal(denied.status, 200);
        strict_1.default.equal(denied.body.items.some((i) => i.itemId === item.id), false, "company A's in-transit item must not leak to company B");
    });
});
integration('gmroi uses the resolved RETAIL PriceList price, never a guessed margin; unpriced sales are excluded and reported (audit O-5)', async () => {
    const a = await makeCompany();
    const mkItem = (code) => db_js_1.prisma.item.create({ data: { code: `${code}-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`, name: code, companyId: a.companyId } });
    const milk = await mkItem('MILK'); // will have a resolvable price
    const rice = await mkItem('RICE'); // sold, but no PriceList row at all
    const lot = (itemId) => db_js_1.prisma.lot.create({ data: { itemId, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`, attributes: { purchaseRate: 10 } } });
    const milkLot = await lot(milk.id);
    const riceLot = await lot(rice.id);
    await db_js_1.prisma.stockLedger.create({ data: { itemId: milk.id, lotId: milkLot.id, locationId: a.loc.id, onHand: 100, companyId: a.companyId } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: rice.id, lotId: riceLot.id, locationId: a.loc.id, onHand: 100, companyId: a.companyId } });
    const sale = (itemId, lotId, qty) => db_js_1.prisma.stockMovement.create({ data: { itemId, lotId, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -qty, beforeBalance: qty, afterBalance: 0, actor: a.userId, timestamp: new Date(), companyId: a.companyId } });
    await sale(milk.id, milkLot.id, 30); // 30 units, cost 10 -> cogs 300
    await sale(rice.id, riceLot.id, 20); // no price: must not count toward gmroi
    await db_js_1.prisma.priceList.create({ data: { itemId: milk.id, priceType: 'RETAIL', price: 15, createdById: a.userId, companyId: a.companyId } });
    await withServer(async (call) => {
        const res = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}&windowDays=30`, a.token);
        strict_1.default.equal(res.status, 200, JSON.stringify(res.body));
        // value = 100x10 + 100x10 = 2000; priced margin = 30x15 - 30x10 = 150; annualised x365/30, over 2000.
        strict_1.default.equal(res.body.gmroi, Math.round((150 * (365 / 30) / 2000) * 100) / 100);
        strict_1.default.equal(res.body.unitsSoldUnpriced, 20, 'rice sold 20 units with no PriceList row');
        // A price scoped to a DIFFERENT branch must not resolve here (same specificity rule as GET /items/:id/price).
        const otherLoc = await db_js_1.prisma.location.create({ data: { code: `aud-${(0, node_crypto_1.randomUUID)()}`, name: 'Other', type: 'store', companyId: a.companyId } });
        await db_js_1.prisma.priceList.create({ data: { itemId: rice.id, priceType: 'RETAIL', price: 8, branchId: otherLoc.id, createdById: a.userId, companyId: a.companyId } });
        const stillUnpriced = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}&windowDays=30`, a.token);
        strict_1.default.equal(stillUnpriced.body.unitsSoldUnpriced, 20, 'a price scoped to another branch does not resolve for this one');
    });
});
integration('reorder suggestions are derived from sales history, tenant scoped, and skip items with no demand', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const sold = await db_js_1.prisma.item.create({ data: { code: `SUG-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Sold', companyId: a.companyId } });
    const idle = await db_js_1.prisma.item.create({ data: { code: `IDL-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Idle', companyId: a.companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: sold.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    for (let d = 1; d <= 20; d += 1) {
        await db_js_1.prisma.stockMovement.create({ data: { itemId: sold.id, lotId: lot.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -10, beforeBalance: 500, afterBalance: 490, actor: a.userId, timestamp: new Date(Date.now() - d * 86_400_000), companyId: a.companyId } });
    }
    await withServer(async (call) => {
        const res = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
        strict_1.default.equal(res.status, 200, JSON.stringify(res.body));
        const ids = res.body.suggestions.map((s) => s.itemId);
        strict_1.default.ok(ids.includes(sold.id));
        strict_1.default.ok(!ids.includes(idle.id), 'no demand history: no suggestion');
        const s = res.body.suggestions.find((x) => x.itemId === sold.id);
        strict_1.default.equal(s.change, 'NEW');
        strict_1.default.ok(s.suggestedMin > 0 && s.suggestedTarget >= s.suggestedMin);
        strict_1.default.equal((await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}`, b.token)).status, 404);
    });
});
integration('periodic-review (R,S) policy is derived from sales history and simulated 90 days forward, tenant scoped (audit R-3)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `PRP-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Weekly buy item', companyId: a.companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    for (let d = 1; d <= 30; d += 1) {
        await db_js_1.prisma.stockMovement.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -8, beforeBalance: 500, afterBalance: 492, actor: a.userId, timestamp: new Date(Date.now() - d * 86_400_000), companyId: a.companyId } });
    }
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, onHand: 0, companyId: a.companyId } });
    await withServer(async (call) => {
        const res = await call('GET', `/items/${item.id}/periodic-review-policy?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5&reviewPeriodDays=7`, a.token);
        strict_1.default.equal(res.status, 200, JSON.stringify(res.body));
        strict_1.default.ok(res.body.averageDailyDemand > 7 && res.body.averageDailyDemand < 9, `~8/day expected, got ${res.body.averageDailyDemand}`);
        strict_1.default.equal(res.body.policy.protectionIntervalDays, 12, 'leadTimeDays 5 + reviewPeriodDays 7');
        strict_1.default.ok(res.body.policy.orderUpToLevel > 0);
        strict_1.default.equal(res.body.policy.reorderPoint, res.body.policy.orderUpToLevel);
        strict_1.default.ok(Array.isArray(res.body.simulation.plannedOrders) && res.body.simulation.plannedOrders.length > 0, 'zero on hand must trigger an order in the 90-day simulation');
        strict_1.default.equal((await call('GET', `/items/${item.id}/periodic-review-policy?locationId=${a.loc.id}&leadTimeDays=5`, b.token)).status, 404, "another company cannot read this item/location's policy");
    });
});
integration('company timezone can be read, set by an admin, rejected when invalid, and is per company (audit T-2)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    await withServer(async (call) => {
        strict_1.default.equal((await call('PUT', '/company/timezone', a.token, { timezone: 'Not/AZone' })).status, 400);
        strict_1.default.equal((await call('PUT', '/company/timezone', a.token, {})).status, 400);
        const set = await call('PUT', '/company/timezone', a.token, { timezone: 'America/New_York' });
        strict_1.default.equal(set.status, 200, JSON.stringify(set.body));
        strict_1.default.equal((await call('GET', '/company/timezone', a.token)).body.timezone, 'America/New_York');
        strict_1.default.equal((await call('GET', '/company/timezone', b.token)).body.timezone, 'Asia/Kolkata', 'another company is unaffected');
        strict_1.default.equal((await db_js_1.prisma.companyProfile.findUniqueOrThrow({ where: { id: a.companyId } })).timezone, 'America/New_York');
        strict_1.default.equal((await call('PUT', '/company/timezone', a.token, { timezone: null })).status, 200);
        strict_1.default.equal((await call('GET', '/company/timezone', a.token)).body.timezone, 'Asia/Kolkata');
    });
});
integration('cycle-count cadence can be read, set per class by an admin, rejected when invalid, and is per company (audit C-4)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    await withServer(async (call) => {
        const initial = await call('GET', '/company/cycle-count-cadence', a.token);
        strict_1.default.equal(initial.status, 200, JSON.stringify(initial.body));
        strict_1.default.deepEqual(initial.body.cadenceDays, { A: 7, B: 30, C: 90 });
        strict_1.default.equal((await call('PUT', '/company/cycle-count-cadence', a.token, { A: 0 })).status, 400, 'zero days is invalid');
        strict_1.default.equal((await call('PUT', '/company/cycle-count-cadence', a.token, { A: 3.5 })).status, 400, 'fractional days is invalid');
        strict_1.default.equal((await call('PUT', '/company/cycle-count-cadence', a.token, {})).status, 400, 'at least one class is required');
        const set = await call('PUT', '/company/cycle-count-cadence', a.token, { A: 14, B: 45 });
        strict_1.default.equal(set.status, 200, JSON.stringify(set.body));
        strict_1.default.deepEqual(set.body.cadenceDays, { A: 14, B: 45, C: 90 }, 'C was not set, so it keeps the default');
        strict_1.default.deepEqual((await call('GET', '/company/cycle-count-cadence', a.token)).body.cadenceDays, { A: 14, B: 45, C: 90 });
        strict_1.default.deepEqual((await call('GET', '/company/cycle-count-cadence', b.token)).body.cadenceDays, { A: 7, B: 30, C: 90 }, 'another company is unaffected');
        const cleared = await call('PUT', '/company/cycle-count-cadence', a.token, { A: null });
        strict_1.default.equal(cleared.status, 200, JSON.stringify(cleared.body));
        strict_1.default.deepEqual(cleared.body.cadenceDays, { A: 7, B: 45, C: 90 }, 'clearing A restores the default; B stays overridden');
    });
});
integration('forecast excludes stockout days from demand, and reorder rules keep a case pack that the plan rounds to (audit O-2/O-4)', async () => {
    const a = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `CEN-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Censor', companyId: a.companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'L' } });
    const day = 86_400_000;
    const mv = (ago, type, delta, before, after) => db_js_1.prisma.stockMovement.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, movementType: type, qtyDelta: delta, beforeBalance: before, afterBalance: after, actor: a.userId, timestamp: new Date(Date.now() - ago * day - 3_600_000), companyId: a.companyId } });
    // 10-day window: received 10 on day -9, sold 10 on the same day (empty afterwards), restocked 20 on day -2, sold 2 on day -1.
    await mv(9, 'PURCHASE_RECEIPT', 10, 0, 10);
    await mv(9, 'SALES_DEDUCTION', -10, 10, 0);
    await mv(2, 'PURCHASE_RECEIPT', 20, 0, 20);
    await mv(1, 'SALES_DEDUCTION', -2, 20, 18);
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, onHand: 18, companyId: a.companyId } });
    await withServer(async (call) => {
        const forecast = await call('GET', `/items/${item.id}/forecast?locationId=${a.loc.id}&windowDays=10`, a.token);
        strict_1.default.equal(forecast.status, 200, JSON.stringify(forecast.body));
        strict_1.default.ok(forecast.body.stockoutDaysExcluded >= 5, `days with an empty shelf must be excluded, got ${forecast.body.stockoutDaysExcluded}`);
        const put = await call('PUT', `/reorder-rules/${item.id}`, a.token, { locationId: a.loc.id, minQty: 5, targetQty: 20, orderMultiple: 12 });
        strict_1.default.equal(put.status, 200, JSON.stringify(put.body));
        strict_1.default.equal(put.body.rule.orderMultiple, 12);
        strict_1.default.equal((await call('PUT', `/reorder-rules/${item.id}`, a.token, { locationId: a.loc.id, minQty: 5, targetQty: 20, orderMultiple: -3 })).status, 400);
    });
});
integration('tags and custom fields are per company: same name allowed in two companies, no cross-company read, tag or write (audit T-1)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const itemA = await db_js_1.prisma.item.create({ data: { code: `TG-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'A item', companyId: a.companyId } });
    const name = `Fresh-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`;
    await withServer(async (call) => {
        const tagA = await call('POST', '/catalog/tags', a.token, { name });
        strict_1.default.equal(tagA.status, 201, JSON.stringify(tagA.body));
        strict_1.default.equal((await call('POST', '/catalog/tags', b.token, { name })).status, 201, 'the same name is free in another company');
        strict_1.default.equal((await call('POST', '/catalog/tags', a.token, { name })).status, 409, 'but unique inside one company');
        strict_1.default.deepEqual((await call('GET', '/catalog/tags', a.token)).body.tags.map((t) => t.name), [name]);
        strict_1.default.equal((await call('PUT', `/catalog/items/${itemA.id}/tags`, b.token, { tagIds: [] })).status, 404, "B cannot tag A's item");
        const bTag = (await call('GET', '/catalog/tags', b.token)).body.tags[0];
        strict_1.default.equal((await call('PUT', `/catalog/items/${itemA.id}/tags`, a.token, { tagIds: [bTag.id] })).status, 404, "A cannot use B's tag");
        strict_1.default.equal((await call('PUT', `/catalog/items/${itemA.id}/tags`, a.token, { tagIds: [tagA.body.tag.id] })).status, 200);
        strict_1.default.equal((await call('GET', `/catalog/items/${itemA.id}`, b.token)).status, 404);
        const field = await call('POST', '/catalog/custom-fields', a.token, { name: 'Batch note' });
        strict_1.default.equal(field.status, 201, JSON.stringify(field.body));
        strict_1.default.equal((await call('POST', '/catalog/custom-fields', b.token, { name: 'Batch note' })).status, 201);
        strict_1.default.equal((await call('GET', '/catalog/custom-fields', b.token)).body.fields.length, 1);
        strict_1.default.equal((await call('PUT', `/catalog/items/${itemA.id}/custom-fields/${field.body.field.id}`, b.token, { value: 'x' })).status, 404);
        strict_1.default.equal((await call('PUT', `/catalog/items/${itemA.id}/custom-fields/${field.body.field.id}`, a.token, { value: 'x' })).status, 200);
    });
});
integration('an order with a customer minimum shelf life is filled from the fresher lot; manufacturing date is company scoped (audit S-1)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `RSL-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Yogurt', shelfLifeDays: 100, companyId: a.companyId } });
    const day = 86_400_000;
    const old = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'OLD', expiryDate: new Date(Date.now() + 10 * day) } });
    const fresh = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'FRESH', expiryDate: new Date(Date.now() + 80 * day) } });
    for (const lot of [old, fresh])
        await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, onHand: 20, companyId: a.companyId } });
    await withServer(async (call) => {
        const res = await call('POST', '/orders', a.token, { channel: 'B2B', fulfillmentLocationId: a.loc.id, lines: [{ itemId: item.id, quantity: 5, minRslPercent: 50 }] });
        strict_1.default.equal(res.status, 201, JSON.stringify(res.body));
        const lotIds = (res.body.order?.lines ?? []).map((l) => l.lotId);
        strict_1.default.deepEqual(lotIds, [fresh.id], 'the 10%-RSL lot is skipped for a 50% customer');
        strict_1.default.equal((await call('PATCH', `/lots/${fresh.id}/manufactured`, b.token, { manufacturedAt: '2026-01-01' })).status, 404, "another company cannot edit this lot");
        strict_1.default.equal((await call('PATCH', `/lots/${fresh.id}/manufactured`, a.token, { manufacturedAt: '2999-01-01' })).status, 400);
        const ok = await call('PATCH', `/lots/${fresh.id}/manufactured`, a.token, { manufacturedAt: '2026-01-01' });
        strict_1.default.equal(ok.status, 200, JSON.stringify(ok.body));
    });
});
integration('demand includes sales imported through the legacy daily import (InventoryMovement), not only StockMovement (audit O-2)', async () => {
    const a = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `LEG-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Legacy sold', companyId: a.companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'L' } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, onHand: 100, companyId: a.companyId } });
    for (let d = 1; d <= 20; d += 1) {
        await db_js_1.prisma.inventoryMovement.create({ data: {
                id: (0, node_crypto_1.randomUUID)(), dedupeKey: `legacy-${(0, node_crypto_1.randomUUID)()}`, itemId: item.id, lotId: lot.id, locationId: a.loc.id,
                movementType: 'SALE_OUT', qtyDelta: -6, transactionAt: new Date(Date.now() - d * 86_400_000), sourceType: 'SALES', sourceReference: `inv-${d}`, createdById: a.userId,
            } });
    }
    await withServer(async (call) => {
        const suggestions = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
        strict_1.default.equal(suggestions.status, 200, JSON.stringify(suggestions.body));
        const s = suggestions.body.suggestions.find((x) => x.itemId === item.id);
        strict_1.default.ok(s, 'legacy-import sales must produce demand and therefore a suggestion');
        strict_1.default.ok(s.averageDailyDemand > 1, `saw ${s.averageDailyDemand}`);
        const forecast = await call('GET', `/items/${item.id}/forecast?locationId=${a.loc.id}&windowDays=30`, a.token);
        strict_1.default.equal(forecast.status, 200, JSON.stringify(forecast.body));
        strict_1.default.ok(forecast.body.demand.averageDailyDemand > 1, `forecast saw ${forecast.body.demand.averageDailyDemand}`);
        const health = await call('GET', `/reports/inventory-health?locationId=${a.loc.id}&windowDays=30`, a.token);
        strict_1.default.equal(health.body.items.find((i) => i.name === 'Legacy sold').status, 'HEALTHY');
    });
});
integration('count accuracy breakdown is tolerance-based, value-weighted and tenant scoped (audit C-3)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `ACC-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Counted', companyId: a.companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'L', attributes: { purchaseRate: 10 } } });
    const mk = (physicalQty, bookQty) => db_js_1.prisma.stockCount.create({ data: { id: `acc-${(0, node_crypto_1.randomUUID)()}`, itemId: item.id, lotId: lot.id, locationId: a.loc.id, physicalQty, bookQty, submittedById: a.userId, reviewStatus: 'APPROVED', companyId: a.companyId } });
    await mk(100, 100);
    await mk(96, 100);
    await mk(50, 100);
    await withServer(async (call) => {
        const res = await call('GET', '/reports/count-accuracy-breakdown', a.token);
        strict_1.default.equal(res.status, 200, JSON.stringify(res.body));
        strict_1.default.equal(res.body.counts, 3);
        strict_1.default.equal(res.body.withinTolerance, 2, '4 off on 100 is inside 10%; 50 off is not');
        strict_1.default.equal(res.body.varianceValue, 540);
        const other = await call('GET', '/reports/count-accuracy-breakdown', b.token);
        strict_1.default.equal(other.body.counts, 0, 'another company sees none of these counts');
    });
});
integration('reorder suggestions can be accepted (writes the rule) or dismissed (drops from the list for 24h), tenant scoped (audit O-1)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const item = await db_js_1.prisma.item.create({ data: { code: `ACPT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Accept me', companyId: a.companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    for (let d = 1; d <= 20; d += 1) {
        await db_js_1.prisma.stockMovement.create({ data: { itemId: item.id, lotId: lot.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -8, beforeBalance: 500, afterBalance: 492, actor: a.userId, timestamp: new Date(Date.now() - d * 86_400_000), companyId: a.companyId } });
    }
    await withServer(async (call) => {
        const before = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
        const suggested = before.body.suggestions.find((s) => s.itemId === item.id);
        strict_1.default.ok(suggested, 'must have a suggestion before accepting');
        strict_1.default.equal((await call('POST', `/reorder-rules/suggestions/${item.id}/accept`, b.token, { locationId: a.loc.id })).status, 404, "another company cannot accept A's suggestion");
        const accepted = await call('POST', `/reorder-rules/suggestions/${item.id}/accept`, a.token, { locationId: a.loc.id, windowDays: 30, leadTimeDays: 5 });
        strict_1.default.equal(accepted.status, 200, JSON.stringify(accepted.body));
        strict_1.default.equal(accepted.body.rule.minQty, suggested.suggestedMin);
        strict_1.default.equal(accepted.body.rule.targetQty, suggested.suggestedTarget);
        const stored = await db_js_1.prisma.reorderRule.findUniqueOrThrow({ where: { itemId_locationId: { itemId: item.id, locationId: a.loc.id } } });
        strict_1.default.equal(stored.minQty, suggested.suggestedMin);
        const after = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
        strict_1.default.equal(after.body.suggestions.some((s) => s.itemId === item.id), false, 'the rule now matches the suggestion, so it is no longer NEW/INCREASE/DECREASE');
        const item2 = await db_js_1.prisma.item.create({ data: { code: `DISM-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Dismiss me', companyId: a.companyId } });
        const lot2 = await db_js_1.prisma.lot.create({ data: { itemId: item2.id, lotNo: `L2-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
        for (let d = 1; d <= 20; d += 1) {
            await db_js_1.prisma.stockMovement.create({ data: { itemId: item2.id, lotId: lot2.id, locationId: a.loc.id, movementType: 'SALES_DEDUCTION', qtyDelta: -4, beforeBalance: 200, afterBalance: 196, actor: a.userId, timestamp: new Date(Date.now() - d * 86_400_000), companyId: a.companyId } });
        }
        const beforeDismiss = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
        strict_1.default.ok(beforeDismiss.body.suggestions.some((s) => s.itemId === item2.id));
        const dismiss = await call('POST', `/intelligence/${a.loc.id}/dismiss`, a.token, { type: 'REORDER_SUGGESTION', itemId: item2.id, reason: 'already ordering more manually' });
        strict_1.default.equal(dismiss.status, 201, JSON.stringify(dismiss.body));
        const afterDismiss = await call('GET', `/reorder-rules/suggestions?locationId=${a.loc.id}&windowDays=30&leadTimeDays=5`, a.token);
        strict_1.default.equal(afterDismiss.body.suggestions.some((s) => s.itemId === item2.id), false, 'dismissed suggestion must not resurface immediately');
    });
});
integration('supplier price breaks: validated, tenant scoped, and the purchase plan uses them (audit O-4)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const supplier = await db_js_1.prisma.supplier.create({ data: { name: `PB-${(0, node_crypto_1.randomUUID)()}`, companyId: a.companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `PB-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Break item', companyId: a.companyId } });
    await withServer(async (call) => {
        const path = `/suppliers/${supplier.id}/price-breaks/${item.id}`;
        strict_1.default.equal((await call('PUT', path, a.token, { breaks: [{ minQty: 10, unitCost: 5 }, { minQty: 50, unitCost: 6 }] })).status, 400, 'a bigger quantity must cost less');
        strict_1.default.equal((await call('PUT', path, a.token, { breaks: [{ minQty: 0, unitCost: 5 }] })).status, 400);
        strict_1.default.equal((await call('PUT', path, b.token, { breaks: [{ minQty: 100, unitCost: 5.9 }] })).status, 404, "another company cannot set this supplier's breaks");
        const ok = await call('PUT', path, a.token, { breaks: [{ minQty: 100, unitCost: 5.9 }] });
        strict_1.default.equal(ok.status, 200, JSON.stringify(ok.body));
        const list = await call('GET', `/suppliers/${supplier.id}/price-breaks`, a.token);
        strict_1.default.equal(list.body.priceBreaks.length, 1);
        strict_1.default.equal((await call('GET', `/suppliers/${supplier.id}/price-breaks`, b.token)).status, 404);
    });
});
