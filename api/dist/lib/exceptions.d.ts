import type { ExceptionCase } from '@prisma/client';
export type ExceptionCaseType = 'DAMAGE' | 'SHORT_RECEIPT' | 'EXCESS_RECEIPT' | 'WRONG_ITEM' | 'EXPIRED' | 'MISSING_STOCK' | 'QC_FAIL' | 'TRANSFER_DISCREPANCY' | 'COUNT_VARIANCE' | 'QUARANTINE';
export type ExceptionPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type CreateExceptionCaseInput = {
    type: ExceptionCaseType;
    title: string;
    description?: string | null;
    itemId?: string | null;
    lotId?: string | null;
    locationId?: string | null;
    branchId?: string | null;
    quantity?: number | null;
    sourceDocument?: string | null;
    sourceLineId?: string | null;
    ownerId?: string | null;
    reportedById: string;
    /** SLA window; defaults to 24h so nothing sits unowned overnight. */
    dueHours?: number;
};
export declare function priorityForValue(value: number | null | undefined): ExceptionPriority;
export declare function estimateValueAtRisk(itemId: string | null | undefined, quantity: number | null | undefined): Promise<number | null>;
/**
 * Opens a new exception case. Never throws for a missing/legacy table on
 * older Hostinger databases that predate the Exception Inbox migration -
 * callers on hot workflow paths (receiving, counting) must not fail the
 * underlying stock transaction just because the case log is unavailable.
 */
export declare function createExceptionCase(input: CreateExceptionCaseInput): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    tenantId: string;
    status: import("@prisma/client").$Enums.ExceptionStatus;
    itemId: string | null;
    lotId: string | null;
    locationId: string | null;
    priority: import("@prisma/client").$Enums.ExceptionPriority;
    type: import("@prisma/client").$Enums.ExceptionType;
    metadata: import("@prisma/client/runtime/client").JsonValue | null;
    branchId: string | null;
    title: string;
    description: string | null;
    dueAt: Date | null;
    closedAt: Date | null;
    quantity: number | null;
    valueAtRisk: number | null;
    sourceDocument: string | null;
    sourceLineId: string | null;
    ownerId: string | null;
    reportedById: string;
    disposition: import("@prisma/client").$Enums.ExceptionDisposition | null;
    resolutionNotes: string | null;
    resolvedAt: Date | null;
}>;
export type ExceptionDisposition = 'RESTOCK' | 'VENDOR_RETURN' | 'MARKDOWN' | 'DESTROY' | 'REWORK' | 'WRITE_OFF' | 'ACCEPT' | 'RECOUNT' | 'ESCALATE' | 'NONE';
/**
 * Blueprint Module H: closing a case with a disposition must move the
 * physical stock it describes out of quarantine, not just record a
 * decision on paper. Only cases that actually hold quarantined quantity
 * (today: DAMAGE cases opened from receiving) have anything to move -
 * every other case type resolves as a paperwork-only decision. Never
 * throws: a stock-ledger mismatch must not block closing the case, since
 * the case's audit trail is the source of truth for what was decided.
 */
export declare function applyExceptionDisposition(exceptionCase: ExceptionCase, disposition: ExceptionDisposition, actorId: string): Promise<void>;
