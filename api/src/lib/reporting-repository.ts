// Week 12 (inferred scope - see docs/week12-reporting-exception-dashboard.md
// for why): the "Reporting" bounded context ADR-005 names but never builds,
// and the exception-first Dashboard Week 10 explicitly deferred as backlog
// because "at risk"/"SLA" per queue needed a product decision this repo had
// not made. This module makes that decision explicitly (constants below)
// rather than leaving it implicit - reproducing what each threshold means is
// the whole point of naming it as a decision, not a fact.
//
// Every export takes a required TenantContext (ADR-002) and scopes its
// query to ctx.companyId. Transfer/StockCount/ExpiryAlert still only carry
// the pre-ADR-002 constant `tenantId` field, not a real `companyId` column
// (the same baseline gap AGENTS.md's Tenant scope row already documents
// for Identity/Organization) - this module closes that gap for its own
// queries the same way Week 10/11 did for their own new code: by scoping
// through each row's Location, which does carry a real companyId, via
// `companyLocationIds`. ExceptionCase (Week 12), PurchaseOrder (Week 17)
// and Order (Week 19) got real `companyId` columns instead - ExceptionCase
// because its `locationId` is optional (a case with no location would fall
// outside any location-based scope entirely); PurchaseOrder and Order as
// successive slices of actually migrating the remaining tenantId-only
// models named above, rather than perpetually working around them.
import { prisma } from './db.js';
import type { TenantContext } from './tenant-context.js';

// This week's product decision on "at risk"/"SLA" per queue. Transfer and
// ReturnRequest have no due-date field in the schema, so their breach
// threshold is a fixed age-since-created window instead of a real due date -
// documented here, not buried in a magic number.
export const TRANSFER_SLA_HOURS = 48;
export const RETURN_SLA_HOURS = 72;
export const STOCK_COUNT_REVIEW_SLA_HOURS = 24;

const OPEN_EXCEPTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL'] as const;
const NON_TERMINAL_TRANSFER_STATUSES = [
  'DRAFT', 'PENDING_PICK', 'REQUESTED', 'PICKING', 'PARTIAL', 'PICKED',
  'READY_FOR_ADMIN', 'CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED',
] as const;
const OPEN_PO_STATUSES = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] as const;
const OPEN_ORDER_STATUSES = ['RESERVED', 'BACKORDERED'] as const;
const OPEN_RETURN_STATUSES = ['REQUESTED', 'APPROVED'] as const;
const OPEN_COUNT_REVIEW_STATUSES = ['PENDING_REVIEW', 'RECOUNT'] as const;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/** Location ids belonging to this company - the scoping join for models that only carry the constant tenantId, not a real companyId column. */
async function companyLocationIds(ctx: TenantContext): Promise<string[]> {
  const locations = await prisma.location.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
  return locations.map((l) => l.id);
}

export type ExceptionQueueSummary = {
  open: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  breached: number;
};

/** Counts over ExceptionCase, the existing cross-module exception inbox (blueprint Module H) - genuinely company-scoped as of this week. */
export async function getExceptionQueueSummary(ctx: TenantContext): Promise<ExceptionQueueSummary> {
  const [statusGroups, priorityGroups, breached] = await Promise.all([
    prisma.exceptionCase.groupBy({ by: ['status'], where: { companyId: ctx.companyId }, _count: { _all: true } }),
    prisma.exceptionCase.groupBy({
      by: ['priority'],
      where: { companyId: ctx.companyId, status: { in: [...OPEN_EXCEPTION_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.exceptionCase.count({
      where: {
        companyId: ctx.companyId,
        status: { in: [...OPEN_EXCEPTION_STATUSES] },
        dueAt: { lt: new Date() },
      },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) byStatus[g.status] = g._count._all;
  const byPriority: Record<string, number> = {};
  for (const g of priorityGroups) byPriority[g.priority] = g._count._all;
  const open = OPEN_EXCEPTION_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);

  return { open, byStatus, byPriority, breached };
}

export type ExceptionListItem = {
  id: string;
  type: string;
  status: string;
  priority: string;
  title: string;
  dueAt: Date | null;
  itemId: string | null;
  locationId: string | null;
  valueAtRisk: number | null;
};

export type ExceptionListPage = { items: ExceptionListItem[]; nextCursor: string | null };

const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

/**
 * Cursor-paginated open exceptions, soonest-due first (nulls last) -
 * mirrors Week 10's searchItems pagination shape ({items, nextCursor}).
 * Sorted only by dueAt, not additionally by priority within the same due
 * date - a deliberate simplification (true priority ordering needs a raw
 * SQL CASE, since ExceptionPriority's enum order isn't alphabetical) rather
 * than a silent inaccuracy.
 */
export async function listOpenExceptions(ctx: TenantContext, options: { cursor?: string; limit?: number } = {}): Promise<ExceptionListPage> {
  const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const rows = await prisma.exceptionCase.findMany({
    where: { companyId: ctx.companyId, status: { in: [...OPEN_EXCEPTION_STATUSES] } },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id, type: row.type, status: row.status, priority: row.priority, title: row.title,
      dueAt: row.dueAt, itemId: row.itemId, locationId: row.locationId, valueAtRisk: row.valueAtRisk,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export type StockRiskSummary = {
  stockouts: number;
  quarantined: number;
  activeExpiryAlerts: number;
};

/**
 * "Stock risk" this week means: a stock line at or below zero on-hand
 * (stockout), a stock line with unresolved quarantine quantity, or an
 * ACTIVE ExpiryAlert. There is no reorder-point/min-stock field anywhere in
 * the schema yet (replenishment thresholds, if any, are out of this
 * module's reach) - a "will stock out soon" projection is explicit backlog,
 * not attempted here.
 */
export async function getStockRiskSummary(ctx: TenantContext): Promise<StockRiskSummary> {
  const [stockouts, quarantined, activeExpiryAlerts] = await Promise.all([
    prisma.stockLedger.count({ where: { companyId: ctx.companyId, onHand: { lte: 0 } } }),
    prisma.stockLedger.count({ where: { companyId: ctx.companyId, quarantine: { gt: 0 } } }),
    (async () => {
      const ids = await companyLocationIds(ctx);
      if (!ids.length) return 0;
      return prisma.expiryAlert.count({ where: { locationId: { in: ids }, status: 'ACTIVE' } });
    })(),
  ]);
  return { stockouts, quarantined, activeExpiryAlerts };
}

export type QueueBacklog = { pending: number; breached: number };
export type QueueBacklogSummary = {
  transfers: QueueBacklog;
  purchaseOrders: QueueBacklog;
  orders: QueueBacklog;
  returns: QueueBacklog;
  stockCounts: QueueBacklog;
};

/** Pending/breached counts for the six domain-policy queues (QcInspection excluded - it has no status/queue concept, see domain-policies.ts). */
export async function getQueueBacklogSummary(ctx: TenantContext): Promise<QueueBacklogSummary> {
  const locationIds = await companyLocationIds(ctx);
  const inCompanyLocations = locationIds.length ? { in: locationIds } : { in: [] as string[] };

  const [
    transfersPending, transfersBreached,
    poPending, poBreached,
    ordersPending, ordersBreached,
    returnsPending, returnsBreached,
    countsPending, countsBreached,
  ] = await Promise.all([
    prisma.transfer.count({ where: { sourceLocationId: inCompanyLocations, status: { in: [...NON_TERMINAL_TRANSFER_STATUSES] } } }),
    prisma.transfer.count({
      where: {
        sourceLocationId: inCompanyLocations,
        status: { in: [...NON_TERMINAL_TRANSFER_STATUSES] },
        createdAt: { lt: hoursAgo(TRANSFER_SLA_HOURS) },
      },
    }),
    prisma.purchaseOrder.count({ where: { companyId: ctx.companyId, status: { in: [...OPEN_PO_STATUSES] } } }),
    prisma.purchaseOrder.count({
      where: { companyId: ctx.companyId, status: { in: [...OPEN_PO_STATUSES] }, expectedAt: { lt: new Date() } },
    }),
    prisma.order.count({ where: { companyId: ctx.companyId, status: { in: [...OPEN_ORDER_STATUSES] } } }),
    prisma.order.count({
      where: { companyId: ctx.companyId, status: { in: [...OPEN_ORDER_STATUSES] }, estimatedDispatchAt: { lt: new Date() } },
    }),
    prisma.returnRequest.count({ where: { companyId: ctx.companyId, status: { in: [...OPEN_RETURN_STATUSES] } } }),
    prisma.returnRequest.count({
      where: { companyId: ctx.companyId, status: { in: [...OPEN_RETURN_STATUSES] }, createdAt: { lt: hoursAgo(RETURN_SLA_HOURS) } },
    }),
    prisma.stockCount.count({ where: { locationId: inCompanyLocations, reviewStatus: { in: [...OPEN_COUNT_REVIEW_STATUSES] } } }),
    prisma.stockCount.count({
      where: { locationId: inCompanyLocations, reviewStatus: { in: [...OPEN_COUNT_REVIEW_STATUSES] }, countDate: { lt: hoursAgo(STOCK_COUNT_REVIEW_SLA_HOURS) } },
    }),
  ]);

  return {
    transfers: { pending: transfersPending, breached: transfersBreached },
    purchaseOrders: { pending: poPending, breached: poBreached },
    orders: { pending: ordersPending, breached: ordersBreached },
    returns: { pending: returnsPending, breached: returnsBreached },
    stockCounts: { pending: countsPending, breached: countsBreached },
  };
}

export type DashboardSummary = {
  exceptions: ExceptionQueueSummary;
  stockRisk: StockRiskSummary;
  queues: QueueBacklogSummary;
};

/** The single combined read model behind GET /reports/dashboard. */
export async function getDashboardSummary(ctx: TenantContext): Promise<DashboardSummary> {
  const [exceptions, stockRisk, queues] = await Promise.all([
    getExceptionQueueSummary(ctx),
    getStockRiskSummary(ctx),
    getQueueBacklogSummary(ctx),
  ]);
  return { exceptions, stockRisk, queues };
}
