export type SerialStatus = 'IN_STOCK' | 'RESERVED' | 'SOLD' | 'RETURNED' | 'DAMAGED' | 'LOST';
export type SerialMovementType = 'RECEIVE' | 'TRANSFER' | 'PICK' | 'PACK' | 'SALE' | 'RETURN' | 'ADJUSTMENT';
export declare class SerialTransitionError extends Error {
    constructor(from: SerialStatus, to: SerialStatus);
}
export declare function assertValidSerialTransition(from: SerialStatus, to: SerialStatus): void;
export type PlannedSerialMovement = {
    movementType: SerialMovementType;
    fromLocationId: string | null;
    toLocationId: string | null;
    fromStatus: SerialStatus;
    toStatus: SerialStatus;
    reference: string | null;
    actorId: string | null;
};
export declare function planSerialMovement(input: {
    currentStatus: SerialStatus;
    toStatus: SerialStatus;
    movementType: SerialMovementType;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    reference?: string | null;
    actorId?: string | null;
}): PlannedSerialMovement;
export type SerialMovementRecord = {
    id: string;
    movementType: string;
    fromLocationId: string | null;
    toLocationId: string | null;
    fromStatus: string | null;
    toStatus: string;
    reference: string | null;
    actorId: string | null;
    createdAt: Date | string;
};
export type TraceStep = {
    at: string;
    event: string;
    fromLocationId: string | null;
    toLocationId: string | null;
    reference: string | null;
    actorId: string | null;
};
/**
 * Blueprint P3 "Recall trace": given a serial, show supplier receipt -> bins
 * -> transfers -> order/customer/branch -> returns/disposition, in order.
 */
export declare function buildRecallTrace(movements: SerialMovementRecord[]): TraceStep[];
