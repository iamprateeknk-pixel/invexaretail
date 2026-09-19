import type { CountAssignmentRecord, CountRecord, TransferRecord } from './repository.js';
export type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
export type CommandCenterInput = {
    now: Date;
    locations: Array<{
        id: string;
        name: string;
        type?: string;
    }>;
    counts: CountRecord[];
    assignments: CountAssignmentRecord[];
    transfers: TransferRecord[];
    checkpoints: Array<{
        locationId: string;
        sourceType: 'SALES' | 'PURCHASE';
        syncedThroughAt: string;
    }>;
    audit: Array<{
        actorId: string;
        action: string;
        entityType: string;
        entityId: string;
        createdAt: string;
    }>;
    userNames: Map<string, string>;
    live: {
        clients: number;
        lastEventId: number;
    };
    extras?: {
        exceptions?: {
            open: number;
            critical: number;
            overdue: number;
        };
        approvals?: {
            pending: number;
        };
    };
};
export declare const STAGE_LIMIT_HOURS: Record<string, number>;
/** When the transfer entered its current stage, as best the record knows. */
export declare function stageSince(transfer: TransferRecord): string;
export declare function stuckTransfers(transfers: TransferRecord[], now: Date): {
    rows: {
        transferId: string;
        stage: "SUBMITTED" | "REJECTED" | "CANCELLED" | "REQUESTED" | "PICKING" | "PICKED" | "IN_TRANSIT" | "DISPATCHED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "PARTIAL_RECEIVED" | "DRAFT" | "PENDING_PICK" | "PARTIAL" | "READY_FOR_ADMIN" | "CONFIRMED";
        ageHours: number;
        limitHours: number;
        from: string;
        to: string;
        pastPromise: boolean;
    }[];
    byStage: Record<string, number>;
};
export declare function lastDays(now: Date, count: number): string[];
export declare function buildCommandCenter(input: CommandCenterInput): {
    generatedAt: string;
    attention: {
        severity: Severity;
        key: string;
        title: string;
        count: number;
        section: string;
    }[];
    sync: {
        liveClients: number;
        lastEventId: number;
        staleBranches: number;
        totalBranches: number;
    };
    branchHealth: {
        readonly locationId: string;
        readonly name: string;
        readonly type: string;
        readonly status: "RED" | "AMBER" | "GREEN";
        readonly reasons: string[];
        readonly salesSyncedAgeHours: number;
        readonly purchaseSyncedAgeHours: number;
        readonly openAssignments: number;
        readonly overdueAssignments: number;
        readonly pendingReview: number;
        readonly stuckTransfers: number;
        readonly countAccuracy7d: number;
    }[];
    pulse: {
        day: string;
        countsSubmitted: number;
        transfersCreated: number;
        transfersDispatched: number;
        receipts: number;
    }[];
    blocked: {
        approvals: number;
        exceptions: {
            open: number;
            critical: number;
            overdue: number;
        };
        stuckTransfers: number;
        countsAwaitingReview: number;
        reconciliation: number;
    };
    stuckTransfers: {
        rows: {
            transferId: string;
            stage: "SUBMITTED" | "REJECTED" | "CANCELLED" | "REQUESTED" | "PICKING" | "PICKED" | "IN_TRANSIT" | "DISPATCHED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "PARTIAL_RECEIVED" | "DRAFT" | "PENDING_PICK" | "PARTIAL" | "READY_FOR_ADMIN" | "CONFIRMED";
            ageHours: number;
            limitHours: number;
            from: string;
            to: string;
            pastPromise: boolean;
        }[];
        byStage: Record<string, number>;
    };
    team: {
        recountRate: number;
        counts: number;
        approved: number;
        recount: number;
        receipts: number;
        cartons: number;
        userId: string;
        name: string;
    }[];
    heatmap: {
        locationId: string;
        name: string;
        days: {
            day: string;
            total: number;
            done: number;
            ratio: number;
        }[];
    }[];
    recent: {
        action: string;
        entityType: string;
        entityId: string;
        at: string;
        actor: string;
    }[];
};
export type CommandCenter = ReturnType<typeof buildCommandCenter>;
