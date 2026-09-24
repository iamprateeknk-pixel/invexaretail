import type { TenantContext } from './tenant-context.js';
export declare const TRANSFER_SLA_HOURS = 48;
export declare const RETURN_SLA_HOURS = 72;
export declare const STOCK_COUNT_REVIEW_SLA_HOURS = 24;
export type ExceptionQueueSummary = {
    open: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    breached: number;
};
/** Counts over ExceptionCase, the existing cross-module exception inbox (blueprint Module H) - genuinely company-scoped as of this week. */
export declare function getExceptionQueueSummary(ctx: TenantContext): Promise<ExceptionQueueSummary>;
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
export type ExceptionListPage = {
    items: ExceptionListItem[];
    nextCursor: string | null;
};
/**
 * Cursor-paginated open exceptions, soonest-due first (nulls last) -
 * mirrors Week 10's searchItems pagination shape ({items, nextCursor}).
 * Sorted only by dueAt, not additionally by priority within the same due
 * date - a deliberate simplification (true priority ordering needs a raw
 * SQL CASE, since ExceptionPriority's enum order isn't alphabetical) rather
 * than a silent inaccuracy.
 */
export declare function listOpenExceptions(ctx: TenantContext, options?: {
    cursor?: string;
    limit?: number;
}): Promise<ExceptionListPage>;
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
export declare function getStockRiskSummary(ctx: TenantContext): Promise<StockRiskSummary>;
export type QueueBacklog = {
    pending: number;
    breached: number;
};
export type QueueBacklogSummary = {
    transfers: QueueBacklog;
    purchaseOrders: QueueBacklog;
    orders: QueueBacklog;
    returns: QueueBacklog;
    stockCounts: QueueBacklog;
};
/** Pending/breached counts for the six domain-policy queues (QcInspection excluded - it has no status/queue concept, see domain-policies.ts). */
export declare function getQueueBacklogSummary(ctx: TenantContext): Promise<QueueBacklogSummary>;
export type DashboardSummary = {
    exceptions: ExceptionQueueSummary;
    stockRisk: StockRiskSummary;
    queues: QueueBacklogSummary;
};
/** The single combined read model behind GET /reports/dashboard. */
export declare function getDashboardSummary(ctx: TenantContext): Promise<DashboardSummary>;
