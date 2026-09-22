import { Prisma } from '@prisma/client';
export type ReversibleMovement = {
    id: string;
    itemId: string;
    lotId: string | null;
    locationId: string;
    qtyDelta: number;
    movementType: string;
};
export type ReversalPlanLine = {
    itemId: string;
    lotId: string;
    locationId: string;
    qtyDelta: number;
    sourceMovementIds: string[];
};
export declare function buildReversalPlan(movements: ReversibleMovement[]): ReversalPlanLine[];
export declare function buildOpeningSnapshotReversalPlan(snapshots: Array<{
    id: string;
    itemId: string;
    lotId: string;
    locationId: string;
    qty: number;
}>): ReversalPlanLine[];
export declare function listImportBatches(limit?: number): Promise<Pick<import("./import-batch-store.js").ImportBatchRecord, "id" | "status" | "type" | "fileName" | "importedAt" | "totalRows" | "validRows" | "invalidRows" | "duplicateRows" | "metadata" | "branchId">[] | {
    id: string;
    status: string;
    type: string;
    fileName: string;
    importedAt: Date;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    metadata: Prisma.JsonValue;
    branchId: string;
}[]>;
export declare function reverseImportBatch(input: {
    batchId: string;
    actorId: string;
    reason: string;
}): Promise<{
    duplicate: boolean;
    reversalBatchId?: string;
    reversedMovements: number;
    plan: ReversalPlanLine[];
}>;
