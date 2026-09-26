import { expiryDayNumber, todayDayNumber } from './expiry-date.js';
import { currentTimezone } from './timezone-context.js';
import type { CountRecord, ItemRecord, TransferRecord } from './repository.js';

function localDateString(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export type DashboardSummaryInput = {
  counts: CountRecord[];
  transfers: TransferRecord[];
  items: ItemRecord[];
};

export type DashboardSummary = {
  pendingCounts: number;
  transferRequests: number;
  expiredTillDate: number;
  nearExpiryThisMonth: number;
  nearExpiryNextMonth: number;
  countCompletionPercent: number;
  transferSlaPercent: number;
  stockAccuracyPercent: number;
};

export type ReportSummaryInput = {
  locationId: string;
  counts: CountRecord[];
  transfers: TransferRecord[];
};

export type ReportSummary = {
  locationId: string;
  totalCounts: number;
  totalTransfers: number;
  dispatchedTransfers: number;
};

/**
 * Audit fixes (P0-2): the old version (1) reported EVERY count as "pending", (2)
 * counted an item as expired if any historic lot had ever passed its date even with
 * zero stock, (3) treated a lot expiring today as already expired, and (4) built a
 * "next month" window that was effectively one day wide. Expiry KPIs now count only
 * items that still hold stock in the lot, using the shared business-timezone day
 * maths, and "this/next month" are real calendar-month windows.
 */
export function buildDashboardSummary(input: DashboardSummaryInput & { stock?: Array<{ itemId: string; lotId: string; onHand: number }>; now?: Date }): DashboardSummary {
  const now = input.now ?? new Date();
  const pendingCounts = input.counts.filter((count) => !count.status || count.status === 'PENDING_REVIEW' || count.status === 'RECOUNT').length;
  const transferRequests = input.transfers.filter((transfer) => transfer.status === 'REQUESTED').length;

  const today = todayDayNumber(now);
  const [year, month] = localDateString(now, currentTimezone()).split('-').map(Number);
  const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
  const thisMonthEnd = dayNumber(year, month + 1, 0);
  const nextMonthEnd = dayNumber(year, month + 2, 0);
  // With a stock snapshot only lots that still hold stock count; without one (older callers) every dated lot does.
  const holding = input.stock ? new Set(input.stock.filter((row) => row.onHand > 0).map((row) => `${row.itemId}|${row.lotId}`)) : null;
  const lotsInScope = (item: DashboardSummaryInput['items'][number]) => item.lots.filter((lot) => lot.expiryDate && (!holding || holding.has(`${item.id}|${lot.id}`)));
  const itemsWhere = (predicate: (day: number) => boolean) => input.items.filter((item) => lotsInScope(item).some((lot) => {
    const day = expiryDayNumber(lot.expiryDate);
    return day !== null && predicate(day);
  })).length;

  const expiredTillDate = itemsWhere((day) => day < today);
  const nearExpiryThisMonth = itemsWhere((day) => day >= today && day <= thisMonthEnd);
  const nearExpiryNextMonth = itemsWhere((day) => day > thisMonthEnd && day <= nextMonthEnd);

  const reviewedCounts = input.counts.filter((count) => count.status === 'APPROVED' || count.status === 'REJECTED');
  // Accuracy is judged on counts that have been reviewed - an unreviewed or recount-pending
  // count is not yet a verdict (audit C-3: it used to include them in the denominator).
  const matchingCounts = reviewedCounts.filter((count) => Number(count.physicalQuantity ?? 0) === Number(count.bookQty ?? 0));
  const closedTransfers = input.transfers.filter((transfer) => ['RECEIVED', 'CLOSED'].includes(transfer.status)).length;

  const countCompletionPercent = input.counts.length
    ? Math.round((reviewedCounts.length / input.counts.length) * 1000) / 10
    : 0;
  const transferSlaPercent = input.transfers.length
    ? Math.round((closedTransfers / input.transfers.length) * 1000) / 10
    : 0;
  const stockAccuracyPercent = reviewedCounts.length
    ? Math.round((matchingCounts.length / reviewedCounts.length) * 1000) / 10
    : 0;

  return {
    pendingCounts,
    transferRequests,
    expiredTillDate,
    nearExpiryThisMonth,
    nearExpiryNextMonth,
    countCompletionPercent,
    transferSlaPercent,
    stockAccuracyPercent,
  };
}

export function buildReportSummary(input: ReportSummaryInput): ReportSummary {
  const totalCounts = input.counts.filter((count) => count.locationId === input.locationId).length;
  const totalTransfers = input.transfers.filter(
    (transfer) => transfer.sourceLocationId === input.locationId || transfer.destinationLocationId === input.locationId,
  ).length;
  const dispatchedTransfers = input.transfers.filter(
    (transfer) => transfer.status === 'DISPATCHED' && (transfer.sourceLocationId === input.locationId || transfer.destinationLocationId === input.locationId),
  ).length;

  return {
    locationId: input.locationId,
    totalCounts,
    totalTransfers,
    dispatchedTransfers,
  };
}
