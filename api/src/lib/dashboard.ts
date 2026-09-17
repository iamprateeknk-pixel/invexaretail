import type { CountRecord, ItemRecord, TransferRecord } from './repository.js';

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

export function buildDashboardSummary(input: DashboardSummaryInput): DashboardSummary {
  const pendingCounts = input.counts.length;
  const transferRequests = input.transfers.filter((transfer) => transfer.status === 'REQUESTED').length;

  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const expiredTillDate = input.items.filter((item) =>
    item.lots.some((lot) => lot.expiryDate && new Date(lot.expiryDate) < today),
  ).length;

  const nearExpiryThisMonth = input.items.filter((item) =>
    item.lots.some((lot) => {
      if (!lot.expiryDate) return false;
      const expiry = new Date(lot.expiryDate);
      return expiry >= today && expiry <= new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }),
  ).length;

  const nearExpiryNextMonth = input.items.filter((item) =>
    item.lots.some((lot) => {
      if (!lot.expiryDate) return false;
      const expiry = new Date(lot.expiryDate);
      return expiry > new Date(today.getFullYear(), today.getMonth() + 1, 0) && expiry <= nextMonth;
    }),
  ).length;

  const reviewedCounts = input.counts.filter((count) => count.status === 'APPROVED' || count.status === 'REJECTED');
  const matchingCounts = input.counts.filter((count) => Number(count.physicalQuantity ?? 0) === Number(count.bookQty ?? 0));
  const closedTransfers = input.transfers.filter((transfer) => ['RECEIVED', 'CLOSED'].includes(transfer.status)).length;

  const countCompletionPercent = input.counts.length
    ? Math.round((reviewedCounts.length / input.counts.length) * 1000) / 10
    : 0;
  const transferSlaPercent = input.transfers.length
    ? Math.round((closedTransfers / input.transfers.length) * 1000) / 10
    : 0;
  const stockAccuracyPercent = input.counts.length
    ? Math.round((matchingCounts.length / input.counts.length) * 1000) / 10
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
