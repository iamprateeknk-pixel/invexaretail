export type ImportSourceType = 'SALES' | 'PURCHASE';
export type DayStatus = 'UPLOADED' | 'PARTIAL' | 'MISSING';
export type MovementActivity = {
    locationId: string;
    sourceType: ImportSourceType;
    count: number;
    lastTransactionAt: string;
    batchIds: string[];
};
export type ControlCenterLocation = {
    id: string;
    name: string;
    type: 'store' | 'warehouse';
};
export type BranchDay = {
    locationId: string;
    locationName: string;
    status: DayStatus;
    movements: number;
    lastTransactionAt: string | null;
    rejectedRows: number;
};
export type SourceDay = {
    status: DayStatus;
    branches: BranchDay[];
    batchIds: string[];
    unattributedRejectedRows: number;
};
export type ControlCenterReport = {
    date: string;
    timezone: string;
    sales: SourceDay;
    purchases: SourceDay;
};
/** The UTC instants that bound one local calendar day. */
export declare function dayWindow(date: string, timezone: string): {
    from: string;
    to: string;
};
export declare function todayFor(timezone: string, now?: Date): string;
/**
 * Sales are expected from every store, so a store with no sales that day is
 * MISSING. Purchases are only expected where they happen, so only locations
 * with purchase activity (or rejected purchase rows) are listed.
 */
export declare function buildControlCenter(input: {
    date: string;
    timezone: string;
    locations: ControlCenterLocation[];
    activity: MovementActivity[];
    rejectedByLocation: Map<string, {
        sales: number;
        purchases: number;
    }>;
    unattributedRejected: {
        sales: number;
        purchases: number;
    };
}): ControlCenterReport;
export type RowReason = 'UNMATCHED_ITEM' | 'UNMATCHED_BRANCH' | 'UNMATCHED_LOT' | 'ARCHIVED_ITEM' | 'OTHER';
/** Buckets a row-level rejection message so the preview can count unmatched items, branches and lots separately. */
export declare function classifyImportError(message: string): RowReason;
export type RowCounters = {
    total: number;
    valid: number;
    duplicate: number;
    unmatchedItem: number;
    unmatchedBranch: number;
    unmatchedLot: number;
    archivedItem: number;
    rejected: number;
};
/** One rejected row is counted once, under its most specific reason. */
export declare function summarizeRowCounters(rows: Array<{
    status: 'VALID' | 'INVALID' | 'DUPLICATE';
    errors?: string[] | null;
}>): RowCounters;
