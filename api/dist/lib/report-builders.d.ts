import type { CountRecord, ItemRecord, TransferRecord } from './repository.js';
export type AuditRow = {
    actorId: string;
    actorRole?: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
};
export type CycleRow = {
    transferId: string;
    from: string;
    to: string;
    status: string;
    requestToDispatchHours: number | null;
    transitHours: number | null;
    totalHours: number | null;
    discrepancy: boolean;
};
/** Cycle time from request to dispatch to receipt, and whether the receipt found damage/short/excess. */
export declare function transferCycleReport(transfers: TransferRecord[], audit: AuditRow[], range?: {
    from?: string;
    to?: string;
}): {
    rows: CycleRow[];
    summary: {
        transfers: number;
        received: number;
        avgRequestToDispatchHours: number;
        medianTransitHours: number;
        avgTotalHours: number;
        discrepancyRatePercent: number;
    };
};
export type AccuracyGroup = 'branch' | 'user' | 'category';
/** Share of reviewed counts that matched the book quantity, and the net variance, per branch / user / category. */
export declare function countAccuracyReport(input: {
    counts: CountRecord[];
    items: ItemRecord[];
    groupBy: AccuracyGroup;
    labels: {
        locations: Map<string, string>;
        users: Map<string, string>;
    };
    range?: {
        from?: string;
        to?: string;
    };
}): {
    accuracyPercent: number;
    recountRatePercent: number;
    key: string;
    label: string;
    counts: number;
    reviewed: number;
    matched: number;
    recount: number;
    netVariance: number;
    absVariance: number;
}[];
/**
 * A spreadsheet treats a cell starting with = + - @ (or a tab/CR) as a formula, so
 * a value an attacker controls (an item name, a note) could run when an auditor
 * opens the export. Such cells are prefixed with an apostrophe.
 */
export declare function csvCell(value: unknown): string;
export type AuditFilter = {
    actorId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    from?: string;
    to?: string;
};
export declare function filterAudit(events: AuditRow[], filter: AuditFilter): AuditRow[];
export declare function auditCsv(events: AuditRow[], actorNames: Map<string, string>): string;
