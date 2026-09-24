"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 12: the Reporting bounded context's exception-first dashboard,
// exercised against real Postgres. Skipped unless TEST_DATABASE_URL is set
// (see AGENTS.md "Required tests").
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const reporting_repository_js_1 = require("./reporting-repository.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
function hoursAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
}
async function makeFixture(companyId = `report-test-${(0, node_crypto_1.randomUUID)()}`) {
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `report-test-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Report Test User', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    const locationId = `report-test-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Report Test Loc', type: 'store', companyId } });
    const itemId = `report-test-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Report Test Item', unit: 'ea', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    const tenant = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
    return { tenant, locationId, itemId, lotId: lot.id, userId };
}
integration('the exception queue summary counts by status and priority, and flags breached (overdue, still-open) cases', async () => {
    const { tenant, itemId, locationId, userId } = await makeFixture();
    await db_js_1.prisma.exceptionCase.create({
        data: {
            type: 'DAMAGE', status: 'OPEN', priority: 'CRITICAL', title: 'Overdue damage case',
            itemId, locationId, reportedById: userId, companyId: tenant.companyId,
            dueAt: hoursAgo(1),
        },
    });
    await db_js_1.prisma.exceptionCase.create({
        data: {
            type: 'QC_FAIL', status: 'IN_PROGRESS', priority: 'LOW', title: 'Not yet due',
            itemId, locationId, reportedById: userId, companyId: tenant.companyId,
            dueAt: new Date(Date.now() + 60 * 60 * 1000),
        },
    });
    await db_js_1.prisma.exceptionCase.create({
        data: {
            type: 'MISSING_STOCK', status: 'CLOSED', priority: 'HIGH', title: 'Already resolved, was overdue',
            itemId, locationId, reportedById: userId, companyId: tenant.companyId,
            dueAt: hoursAgo(5),
        },
    });
    const summary = await (0, reporting_repository_js_1.getExceptionQueueSummary)(tenant);
    strict_1.default.equal(summary.open, 2, 'only OPEN/IN_PROGRESS/PENDING_APPROVAL count as open');
    strict_1.default.equal(summary.byStatus.OPEN, 1);
    strict_1.default.equal(summary.byStatus.IN_PROGRESS, 1);
    strict_1.default.equal(summary.byStatus.CLOSED, 1);
    strict_1.default.equal(summary.byPriority.CRITICAL, 1);
    strict_1.default.equal(summary.byPriority.LOW, 1);
    strict_1.default.equal(summary.breached, 1, 'the closed case must not count as breached even though its dueAt has passed');
});
integration('listOpenExceptions paginates open cases soonest-due first and excludes closed/resolved/rejected cases', async () => {
    const { tenant, itemId, locationId, userId } = await makeFixture();
    const soon = await db_js_1.prisma.exceptionCase.create({
        data: { type: 'DAMAGE', status: 'OPEN', priority: 'MEDIUM', title: 'Due soon', itemId, locationId, reportedById: userId, companyId: tenant.companyId, dueAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const later = await db_js_1.prisma.exceptionCase.create({
        data: { type: 'DAMAGE', status: 'OPEN', priority: 'MEDIUM', title: 'Due later', itemId, locationId, reportedById: userId, companyId: tenant.companyId, dueAt: new Date(Date.now() + 5 * 60 * 60 * 1000) },
    });
    await db_js_1.prisma.exceptionCase.create({
        data: { type: 'DAMAGE', status: 'RESOLVED', priority: 'CRITICAL', title: 'Resolved, must not appear', itemId, locationId, reportedById: userId, companyId: tenant.companyId, dueAt: hoursAgo(1) },
    });
    const page = await (0, reporting_repository_js_1.listOpenExceptions)(tenant, { limit: 1 });
    strict_1.default.equal(page.items.length, 1);
    strict_1.default.equal(page.items[0].id, soon.id);
    strict_1.default.ok(page.nextCursor);
    const page2 = await (0, reporting_repository_js_1.listOpenExceptions)(tenant, { limit: 1, cursor: page.nextCursor });
    strict_1.default.equal(page2.items.length, 1);
    strict_1.default.equal(page2.items[0].id, later.id);
    strict_1.default.equal(page2.nextCursor, null);
});
integration('stock risk summary counts stockouts, quarantined lines and active expiry alerts', async () => {
    const { tenant, itemId, locationId, lotId } = await makeFixture();
    await db_js_1.prisma.stockLedger.create({ data: { itemId, lotId, locationId, onHand: -3, companyId: tenant.companyId } });
    const otherLot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId, lotId: otherLot.id, locationId, onHand: 10, quarantine: 4, companyId: tenant.companyId } });
    await db_js_1.prisma.expiryAlert.create({
        data: { itemId, lotId, locationId, quantity: 5, expiryDate: new Date(Date.now() + 86400000), daysUntilExpiry: 1, status: 'ACTIVE', companyId: tenant.companyId },
    });
    await db_js_1.prisma.expiryAlert.create({
        data: { itemId, lotId: otherLot.id, locationId, quantity: 2, expiryDate: new Date(Date.now() + 86400000), daysUntilExpiry: 1, status: 'RESOLVED', companyId: tenant.companyId },
    });
    const summary = await (0, reporting_repository_js_1.getStockRiskSummary)(tenant);
    strict_1.default.equal(summary.stockouts, 1);
    strict_1.default.equal(summary.quarantined, 1);
    strict_1.default.equal(summary.activeExpiryAlerts, 1, 'only the ACTIVE alert counts, not the RESOLVED one');
});
integration('queue backlog summary counts pending and SLA-breached items across transfers, purchase orders, orders, returns and stock counts', async () => {
    const { tenant, itemId, locationId, lotId, userId } = await makeFixture();
    const destLocation = await db_js_1.prisma.location.create({ data: { id: `report-test-dest-${(0, node_crypto_1.randomUUID)()}`, code: `dest-${(0, node_crypto_1.randomUUID)()}`, name: 'Dest', type: 'store', companyId: tenant.companyId } });
    // Transfer: non-terminal, created long enough ago to breach the fixed SLA window.
    await db_js_1.prisma.transfer.create({
        data: { sourceLocationId: locationId, destinationLocationId: destLocation.id, status: 'REQUESTED', requestedById: userId, companyId: tenant.companyId, createdAt: hoursAgo(reporting_repository_js_1.TRANSFER_SLA_HOURS + 1) },
    });
    await db_js_1.prisma.transfer.create({
        data: { sourceLocationId: locationId, destinationLocationId: destLocation.id, status: 'CLOSED', requestedById: userId, companyId: tenant.companyId, createdAt: hoursAgo(reporting_repository_js_1.TRANSFER_SLA_HOURS + 1) },
    });
    // Purchase order: open and past its own expectedAt due date.
    const supplier = await db_js_1.prisma.supplier.create({ data: { id: `report-test-supplier-${(0, node_crypto_1.randomUUID)()}`, name: 'Test Supplier' } });
    await db_js_1.prisma.purchaseOrder.create({
        data: { number: `PO-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, supplierId: supplier.id, locationId, createdById: userId, companyId: tenant.companyId, status: 'APPROVED', expectedAt: hoursAgo(1) },
    });
    // Order: open and past its own estimatedDispatchAt.
    await db_js_1.prisma.order.create({
        data: { channel: 'web', fulfillmentLocationId: locationId, createdById: userId, companyId: tenant.companyId, status: 'RESERVED', estimatedDispatchAt: hoursAgo(1) },
    });
    // Return request: open, created long enough ago to breach the fixed SLA window.
    const order = await db_js_1.prisma.order.create({ data: { channel: 'web', fulfillmentLocationId: locationId, createdById: userId, companyId: tenant.companyId, status: 'FULFILLED' } });
    await db_js_1.prisma.returnRequest.create({
        data: { orderId: order.id, status: 'REQUESTED', createdById: userId, companyId: tenant.companyId, createdAt: hoursAgo(reporting_repository_js_1.RETURN_SLA_HOURS + 1) },
    });
    // Stock count: pending review, submitted long enough ago to breach the fixed SLA window.
    await db_js_1.prisma.stockCount.create({
        data: { itemId, lotId, locationId, physicalQty: 5, submittedById: userId, companyId: tenant.companyId, reviewStatus: 'PENDING_REVIEW', countDate: hoursAgo(48) },
    });
    const summary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(tenant);
    strict_1.default.equal(summary.transfers.pending, 1);
    strict_1.default.equal(summary.transfers.breached, 1);
    strict_1.default.equal(summary.purchaseOrders.pending, 1);
    strict_1.default.equal(summary.purchaseOrders.breached, 1);
    strict_1.default.equal(summary.orders.pending, 1);
    strict_1.default.equal(summary.orders.breached, 1);
    strict_1.default.equal(summary.returns.pending, 1);
    strict_1.default.equal(summary.returns.breached, 1);
    strict_1.default.equal(summary.stockCounts.pending, 1);
    strict_1.default.equal(summary.stockCounts.breached, 1);
});
integration('the dashboard summary is tenant-scoped: another company sees none of the first company\'s data', async () => {
    const { tenant, itemId, locationId, userId } = await makeFixture();
    const other = await makeFixture();
    await db_js_1.prisma.exceptionCase.create({
        data: { type: 'DAMAGE', status: 'OPEN', priority: 'CRITICAL', title: 'Tenant A only', itemId, locationId, reportedById: userId, companyId: tenant.companyId },
    });
    const ownSummary = await (0, reporting_repository_js_1.getDashboardSummary)(tenant);
    const otherSummary = await (0, reporting_repository_js_1.getDashboardSummary)(other.tenant);
    strict_1.default.equal(ownSummary.exceptions.open, 1);
    strict_1.default.equal(otherSummary.exceptions.open, 0, 'another company must not see the first company\'s exception');
});
integration('PurchaseOrder queue backlog is scoped by its real companyId column (Week 17), not by location join', async () => {
    const { tenant, locationId, userId } = await makeFixture();
    const other = await makeFixture();
    const supplier = await db_js_1.prisma.supplier.create({ data: { id: `report-test-supplier-${(0, node_crypto_1.randomUUID)()}`, name: 'Test Supplier' } });
    // Same real Location.companyId (tenant.companyId), but the PurchaseOrder's
    // own companyId column - the field the query now filters on directly -
    // belongs to a different company. If the query still relied on the old
    // location-join workaround this row would incorrectly count for `tenant`.
    await db_js_1.prisma.purchaseOrder.create({
        data: { number: `PO-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, supplierId: supplier.id, locationId, createdById: userId, companyId: other.tenant.companyId, status: 'APPROVED' },
    });
    const ownSummary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(tenant);
    const otherSummary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(other.tenant);
    strict_1.default.equal(ownSummary.purchaseOrders.pending, 0, 'a purchase order whose companyId belongs to another tenant must not count here, even sharing the same location');
    strict_1.default.equal(otherSummary.purchaseOrders.pending, 1, 'the identical row must count for the tenant its own companyId names');
});
integration('Order queue backlog is scoped by its real companyId column (Week 19), not by location join', async () => {
    const { tenant, locationId, userId } = await makeFixture();
    const other = await makeFixture();
    // Same real Location.companyId (tenant.companyId), but the Order's own
    // companyId column belongs to a different company.
    await db_js_1.prisma.order.create({
        data: { channel: 'web', fulfillmentLocationId: locationId, createdById: userId, companyId: other.tenant.companyId, status: 'RESERVED' },
    });
    const ownSummary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(tenant);
    const otherSummary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(other.tenant);
    strict_1.default.equal(ownSummary.orders.pending, 0, 'an order whose companyId belongs to another tenant must not count here, even sharing the same fulfillment location');
    strict_1.default.equal(otherSummary.orders.pending, 1, 'the identical row must count for the tenant its own companyId names');
});
integration('Transfer queue backlog is scoped by its real companyId column, not by location join', async () => {
    const { tenant, locationId, userId } = await makeFixture();
    const other = await makeFixture();
    const destLocation = await db_js_1.prisma.location.create({ data: { id: `report-test-dest-${(0, node_crypto_1.randomUUID)()}`, code: `dest-${(0, node_crypto_1.randomUUID)()}`, name: 'Dest', type: 'store', companyId: tenant.companyId } });
    // Same real sourceLocation.companyId (tenant.companyId), but the
    // Transfer's own companyId column belongs to a different company.
    await db_js_1.prisma.transfer.create({
        data: { sourceLocationId: locationId, destinationLocationId: destLocation.id, status: 'REQUESTED', requestedById: userId, companyId: other.tenant.companyId },
    });
    const ownSummary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(tenant);
    const otherSummary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(other.tenant);
    strict_1.default.equal(ownSummary.transfers.pending, 0, 'a transfer whose companyId belongs to another tenant must not count here, even sharing the same source location');
    strict_1.default.equal(otherSummary.transfers.pending, 1, 'the identical row must count for the tenant its own companyId names');
});
integration('StockCount queue backlog is scoped by its real companyId column, not by location join', async () => {
    const { tenant, itemId, locationId, lotId, userId } = await makeFixture();
    const other = await makeFixture();
    // Same real Location.companyId (tenant.companyId), but the StockCount's
    // own companyId column belongs to a different company.
    await db_js_1.prisma.stockCount.create({
        data: { itemId, lotId, locationId, physicalQty: 5, submittedById: userId, companyId: other.tenant.companyId, reviewStatus: 'PENDING_REVIEW' },
    });
    const ownSummary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(tenant);
    const otherSummary = await (0, reporting_repository_js_1.getQueueBacklogSummary)(other.tenant);
    strict_1.default.equal(ownSummary.stockCounts.pending, 0, 'a stock count whose companyId belongs to another tenant must not count here, even sharing the same location');
    strict_1.default.equal(otherSummary.stockCounts.pending, 1, 'the identical row must count for the tenant its own companyId names');
});
integration('active ExpiryAlert count is scoped by its real companyId column, not by location join', async () => {
    const { tenant, itemId, locationId, lotId } = await makeFixture();
    const other = await makeFixture();
    // Same real Location.companyId (tenant.companyId), but the ExpiryAlert's
    // own companyId column belongs to a different company.
    await db_js_1.prisma.expiryAlert.create({
        data: { itemId, lotId, locationId, quantity: 3, expiryDate: new Date(Date.now() + 86400000), daysUntilExpiry: 1, status: 'ACTIVE', companyId: other.tenant.companyId },
    });
    const ownSummary = await (0, reporting_repository_js_1.getStockRiskSummary)(tenant);
    const otherSummary = await (0, reporting_repository_js_1.getStockRiskSummary)(other.tenant);
    strict_1.default.equal(ownSummary.activeExpiryAlerts, 0, 'an expiry alert whose companyId belongs to another tenant must not count here, even sharing the same location');
    strict_1.default.equal(otherSummary.activeExpiryAlerts, 1, 'the identical row must count for the tenant its own companyId names');
});
