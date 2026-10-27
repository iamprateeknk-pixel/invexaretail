// Week 12: the Reporting bounded context's exception-first dashboard,
// exercised against real Postgres. Skipped unless TEST_DATABASE_URL is set
// (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import type { TenantContext } from './tenant-context.js';
import {
  getExceptionQueueSummary,
  listOpenExceptions,
  getStockRiskSummary,
  getQueueBacklogSummary,
  getDashboardSummary,
  TRANSFER_SLA_HOURS,
  RETURN_SLA_HOURS,
} from './reporting-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function makeFixture(companyId = `report-test-${randomUUID()}`) {
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `report-test-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Report Test User', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  const locationId = `report-test-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Report Test Loc', type: 'store', companyId } });
  const itemId = `report-test-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Report Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  const tenant: TenantContext = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
  return { tenant, locationId, itemId, lotId: lot.id, userId };
}

integration('the exception queue summary counts by status and priority, and flags breached (overdue, still-open) cases', async () => {
  const { tenant, itemId, locationId, userId } = await makeFixture();
  await prisma.exceptionCase.create({
    data: {
      type: 'DAMAGE', status: 'OPEN', priority: 'CRITICAL', title: 'Overdue damage case',
      itemId, locationId, reportedById: userId, companyId: tenant.companyId,
      dueAt: hoursAgo(1),
    },
  });
  await prisma.exceptionCase.create({
    data: {
      type: 'QC_FAIL', status: 'IN_PROGRESS', priority: 'LOW', title: 'Not yet due',
      itemId, locationId, reportedById: userId, companyId: tenant.companyId,
      dueAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await prisma.exceptionCase.create({
    data: {
      type: 'MISSING_STOCK', status: 'CLOSED', priority: 'HIGH', title: 'Already resolved, was overdue',
      itemId, locationId, reportedById: userId, companyId: tenant.companyId,
      dueAt: hoursAgo(5),
    },
  });

  const summary = await getExceptionQueueSummary(tenant);
  assert.equal(summary.open, 2, 'only OPEN/IN_PROGRESS/PENDING_APPROVAL count as open');
  assert.equal(summary.byStatus.OPEN, 1);
  assert.equal(summary.byStatus.IN_PROGRESS, 1);
  assert.equal(summary.byStatus.CLOSED, 1);
  assert.equal(summary.byPriority.CRITICAL, 1);
  assert.equal(summary.byPriority.LOW, 1);
  assert.equal(summary.breached, 1, 'the closed case must not count as breached even though its dueAt has passed');
});

integration('listOpenExceptions paginates open cases soonest-due first and excludes closed/resolved/rejected cases', async () => {
  const { tenant, itemId, locationId, userId } = await makeFixture();
  const soon = await prisma.exceptionCase.create({
    data: { type: 'DAMAGE', status: 'OPEN', priority: 'MEDIUM', title: 'Due soon', itemId, locationId, reportedById: userId, companyId: tenant.companyId, dueAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  const later = await prisma.exceptionCase.create({
    data: { type: 'DAMAGE', status: 'OPEN', priority: 'MEDIUM', title: 'Due later', itemId, locationId, reportedById: userId, companyId: tenant.companyId, dueAt: new Date(Date.now() + 5 * 60 * 60 * 1000) },
  });
  await prisma.exceptionCase.create({
    data: { type: 'DAMAGE', status: 'RESOLVED', priority: 'CRITICAL', title: 'Resolved, must not appear', itemId, locationId, reportedById: userId, companyId: tenant.companyId, dueAt: hoursAgo(1) },
  });

  const page = await listOpenExceptions(tenant, { limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, soon.id);
  assert.ok(page.nextCursor);

  const page2 = await listOpenExceptions(tenant, { limit: 1, cursor: page.nextCursor! });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0].id, later.id);
  assert.equal(page2.nextCursor, null);
});

integration('stock risk summary counts stockouts, quarantined lines and active expiry alerts', async () => {
  const { tenant, itemId, locationId, lotId } = await makeFixture();
  await prisma.stockLedger.create({ data: { itemId, lotId, locationId, onHand: -3, companyId: tenant.companyId } });
  const otherLot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await prisma.stockLedger.create({ data: { itemId, lotId: otherLot.id, locationId, onHand: 10, quarantine: 4, companyId: tenant.companyId } });
  await prisma.expiryAlert.create({
    data: { itemId, lotId, locationId, quantity: 5, expiryDate: new Date(Date.now() + 86400000), daysUntilExpiry: 1, status: 'ACTIVE', companyId: tenant.companyId },
  });
  await prisma.expiryAlert.create({
    data: { itemId, lotId: otherLot.id, locationId, quantity: 2, expiryDate: new Date(Date.now() + 86400000), daysUntilExpiry: 1, status: 'RESOLVED', companyId: tenant.companyId },
  });

  const summary = await getStockRiskSummary(tenant);
  assert.equal(summary.stockouts, 1);
  assert.equal(summary.quarantined, 1);
  assert.equal(summary.activeExpiryAlerts, 1, 'only the ACTIVE alert counts, not the RESOLVED one');
});

integration('queue backlog summary counts pending and SLA-breached items across transfers, purchase orders, orders, returns and stock counts', async () => {
  const { tenant, itemId, locationId, lotId, userId } = await makeFixture();
  const destLocation = await prisma.location.create({ data: { id: `report-test-dest-${randomUUID()}`, code: `dest-${randomUUID()}`, name: 'Dest', type: 'store', companyId: tenant.companyId } });

  // Transfer: non-terminal, created long enough ago to breach the fixed SLA window.
  await prisma.transfer.create({
    data: { sourceLocationId: locationId, destinationLocationId: destLocation.id, status: 'REQUESTED', requestedById: userId, companyId: tenant.companyId, createdAt: hoursAgo(TRANSFER_SLA_HOURS + 1) },
  });
  await prisma.transfer.create({
    data: { sourceLocationId: locationId, destinationLocationId: destLocation.id, status: 'CLOSED', requestedById: userId, companyId: tenant.companyId, createdAt: hoursAgo(TRANSFER_SLA_HOURS + 1) },
  });

  // Purchase order: open and past its own expectedAt due date.
  const supplier = await prisma.supplier.create({ data: { id: `report-test-supplier-${randomUUID()}`, name: 'Test Supplier', companyId: tenant.companyId } });
  await prisma.purchaseOrder.create({
    data: { number: `PO-${randomUUID().slice(0, 8)}`, supplierId: supplier.id, locationId, createdById: userId, companyId: tenant.companyId, status: 'APPROVED', expectedAt: hoursAgo(1) },
  });

  // Order: open and past its own estimatedDispatchAt.
  await prisma.order.create({
    data: { channel: 'web', fulfillmentLocationId: locationId, createdById: userId, companyId: tenant.companyId, status: 'RESERVED', estimatedDispatchAt: hoursAgo(1) },
  });

  // Return request: open, created long enough ago to breach the fixed SLA window.
  const order = await prisma.order.create({ data: { channel: 'web', fulfillmentLocationId: locationId, createdById: userId, companyId: tenant.companyId, status: 'FULFILLED' } });
  await prisma.returnRequest.create({
    data: { orderId: order.id, status: 'REQUESTED', createdById: userId, companyId: tenant.companyId, createdAt: hoursAgo(RETURN_SLA_HOURS + 1) },
  });

  // Stock count: pending review, submitted long enough ago to breach the fixed SLA window.
  await prisma.stockCount.create({
    data: { itemId, lotId, locationId, physicalQty: 5, submittedById: userId, companyId: tenant.companyId, reviewStatus: 'PENDING_REVIEW', countDate: hoursAgo(48) },
  });

  const summary = await getQueueBacklogSummary(tenant);
  assert.equal(summary.transfers.pending, 1);
  assert.equal(summary.transfers.breached, 1);
  assert.equal(summary.purchaseOrders.pending, 1);
  assert.equal(summary.purchaseOrders.breached, 1);
  assert.equal(summary.orders.pending, 1);
  assert.equal(summary.orders.breached, 1);
  assert.equal(summary.returns.pending, 1);
  assert.equal(summary.returns.breached, 1);
  assert.equal(summary.stockCounts.pending, 1);
  assert.equal(summary.stockCounts.breached, 1);
});

integration('the dashboard summary is tenant-scoped: another company sees none of the first company\'s data', async () => {
  const { tenant, itemId, locationId, userId } = await makeFixture();
  const other = await makeFixture();
  await prisma.exceptionCase.create({
    data: { type: 'DAMAGE', status: 'OPEN', priority: 'CRITICAL', title: 'Tenant A only', itemId, locationId, reportedById: userId, companyId: tenant.companyId },
  });

  const ownSummary = await getDashboardSummary(tenant);
  const otherSummary = await getDashboardSummary(other.tenant);
  assert.equal(ownSummary.exceptions.open, 1);
  assert.equal(otherSummary.exceptions.open, 0, 'another company must not see the first company\'s exception');
});

integration('PurchaseOrder queue backlog is scoped by its real companyId column (Week 17), not by location join', async () => {
  const { tenant, locationId, userId } = await makeFixture();
  const other = await makeFixture();
  const supplier = await prisma.supplier.create({ data: { id: `report-test-supplier-${randomUUID()}`, name: 'Test Supplier', companyId: tenant.companyId } });
  // Same real Location.companyId (tenant.companyId), but the PurchaseOrder's
  // own companyId column - the field the query now filters on directly -
  // belongs to a different company. If the query still relied on the old
  // location-join workaround this row would incorrectly count for `tenant`.
  await prisma.purchaseOrder.create({
    data: { number: `PO-${randomUUID().slice(0, 8)}`, supplierId: supplier.id, locationId, createdById: userId, companyId: other.tenant.companyId, status: 'APPROVED' },
  });

  const ownSummary = await getQueueBacklogSummary(tenant);
  const otherSummary = await getQueueBacklogSummary(other.tenant);
  assert.equal(ownSummary.purchaseOrders.pending, 0, 'a purchase order whose companyId belongs to another tenant must not count here, even sharing the same location');
  assert.equal(otherSummary.purchaseOrders.pending, 1, 'the identical row must count for the tenant its own companyId names');
});

integration('Order queue backlog is scoped by its real companyId column (Week 19), not by location join', async () => {
  const { tenant, locationId, userId } = await makeFixture();
  const other = await makeFixture();
  // Same real Location.companyId (tenant.companyId), but the Order's own
  // companyId column belongs to a different company.
  await prisma.order.create({
    data: { channel: 'web', fulfillmentLocationId: locationId, createdById: userId, companyId: other.tenant.companyId, status: 'RESERVED' },
  });

  const ownSummary = await getQueueBacklogSummary(tenant);
  const otherSummary = await getQueueBacklogSummary(other.tenant);
  assert.equal(ownSummary.orders.pending, 0, 'an order whose companyId belongs to another tenant must not count here, even sharing the same fulfillment location');
  assert.equal(otherSummary.orders.pending, 1, 'the identical row must count for the tenant its own companyId names');
});

integration('Transfer queue backlog is scoped by its real companyId column, not by location join', async () => {
  const { tenant, locationId, userId } = await makeFixture();
  const other = await makeFixture();
  const destLocation = await prisma.location.create({ data: { id: `report-test-dest-${randomUUID()}`, code: `dest-${randomUUID()}`, name: 'Dest', type: 'store', companyId: tenant.companyId } });
  // Same real sourceLocation.companyId (tenant.companyId), but the
  // Transfer's own companyId column belongs to a different company.
  await prisma.transfer.create({
    data: { sourceLocationId: locationId, destinationLocationId: destLocation.id, status: 'REQUESTED', requestedById: userId, companyId: other.tenant.companyId },
  });

  const ownSummary = await getQueueBacklogSummary(tenant);
  const otherSummary = await getQueueBacklogSummary(other.tenant);
  assert.equal(ownSummary.transfers.pending, 0, 'a transfer whose companyId belongs to another tenant must not count here, even sharing the same source location');
  assert.equal(otherSummary.transfers.pending, 1, 'the identical row must count for the tenant its own companyId names');
});

integration('StockCount queue backlog is scoped by its real companyId column, not by location join', async () => {
  const { tenant, itemId, locationId, lotId, userId } = await makeFixture();
  const other = await makeFixture();
  // Same real Location.companyId (tenant.companyId), but the StockCount's
  // own companyId column belongs to a different company.
  await prisma.stockCount.create({
    data: { itemId, lotId, locationId, physicalQty: 5, submittedById: userId, companyId: other.tenant.companyId, reviewStatus: 'PENDING_REVIEW' },
  });

  const ownSummary = await getQueueBacklogSummary(tenant);
  const otherSummary = await getQueueBacklogSummary(other.tenant);
  assert.equal(ownSummary.stockCounts.pending, 0, 'a stock count whose companyId belongs to another tenant must not count here, even sharing the same location');
  assert.equal(otherSummary.stockCounts.pending, 1, 'the identical row must count for the tenant its own companyId names');
});

integration('active ExpiryAlert count is scoped by its real companyId column, not by location join', async () => {
  const { tenant, itemId, locationId, lotId } = await makeFixture();
  const other = await makeFixture();
  // Same real Location.companyId (tenant.companyId), but the ExpiryAlert's
  // own companyId column belongs to a different company.
  await prisma.expiryAlert.create({
    data: { itemId, lotId, locationId, quantity: 3, expiryDate: new Date(Date.now() + 86400000), daysUntilExpiry: 1, status: 'ACTIVE', companyId: other.tenant.companyId },
  });

  const ownSummary = await getStockRiskSummary(tenant);
  const otherSummary = await getStockRiskSummary(other.tenant);
  assert.equal(ownSummary.activeExpiryAlerts, 0, 'an expiry alert whose companyId belongs to another tenant must not count here, even sharing the same location');
  assert.equal(otherSummary.activeExpiryAlerts, 1, 'the identical row must count for the tenant its own companyId names');
});
