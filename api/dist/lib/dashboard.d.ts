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
export declare function buildDashboardSummary(input: DashboardSummaryInput): DashboardSummary;
export declare function buildReportSummary(input: ReportSummaryInput): ReportSummary;
