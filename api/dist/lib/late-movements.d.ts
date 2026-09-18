export type LateMovement = {
    key: string;
    itemId: string;
    lotId?: string;
    locationId: string;
    transactionAt: string;
    qtyDelta: number;
};
export type CountForLate = {
    id: string;
    itemId: string;
    lotId: string;
    locationId: string;
    createdAt: string;
    status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RECOUNT';
    lateMovementKeys?: string[];
};
export type LateOutcome = {
    countId: string;
    lateDelta: number;
    keys: string[];
    action: 'ADJUST_PENDING' | 'FLAG_REVIEWED';
};
/**
 * A movement is "late" for a count when it is for the same item, lot and
 * branch and its transaction time is at or before the moment the count was
 * taken - i.e. it should have been part of the book quantity then.
 */
export declare function planLateMovementReconciliation(counts: CountForLate[], movements: LateMovement[]): LateOutcome[];
export declare function reconciliationNote(outcome: LateOutcome, before: number, after: number, sources: string): string;
