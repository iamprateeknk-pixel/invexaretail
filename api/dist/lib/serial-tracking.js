"use strict";
// Blueprint P3 "Traceability 3.0": serial movement must reconcile with the
// stock ledger and can never create stock the ledger does not own - so this
// module never touches Prisma directly. It only decides whether a status
// transition is legal and shapes the movement row the caller should persist
// alongside its own stock-ledger write. Persistence lives in the route.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerialTransitionError = void 0;
exports.assertValidSerialTransition = assertValidSerialTransition;
exports.planSerialMovement = planSerialMovement;
exports.buildRecallTrace = buildRecallTrace;
// A serial unit can be in only one physical inventory state at a time
// (blueprint §20 invariant) - this table is the single source of truth for
// which transitions are legal, so no caller can sidestep it.
const VALID_TRANSITIONS = {
    IN_STOCK: ['IN_STOCK', 'RESERVED', 'SOLD', 'DAMAGED', 'LOST'],
    RESERVED: ['IN_STOCK', 'SOLD', 'DAMAGED', 'LOST'],
    SOLD: ['RETURNED'],
    RETURNED: ['IN_STOCK', 'DAMAGED'],
    DAMAGED: ['IN_STOCK', 'LOST'],
    LOST: ['IN_STOCK'],
};
class SerialTransitionError extends Error {
    constructor(from, to) {
        super(`Serial cannot move from ${from} to ${to}.`);
        this.name = 'SerialTransitionError';
    }
}
exports.SerialTransitionError = SerialTransitionError;
function assertValidSerialTransition(from, to) {
    if (!VALID_TRANSITIONS[from]?.includes(to)) {
        throw new SerialTransitionError(from, to);
    }
}
function planSerialMovement(input) {
    assertValidSerialTransition(input.currentStatus, input.toStatus);
    return {
        movementType: input.movementType,
        fromLocationId: input.fromLocationId ?? null,
        toLocationId: input.toLocationId ?? null,
        fromStatus: input.currentStatus,
        toStatus: input.toStatus,
        reference: input.reference ?? null,
        actorId: input.actorId ?? null,
    };
}
const EVENT_LABEL = {
    RECEIVE: 'Received from supplier',
    TRANSFER: 'Transferred between locations',
    PICK: 'Picked for an order',
    PACK: 'Packed for dispatch',
    SALE: 'Sold',
    RETURN: 'Returned',
    ADJUSTMENT: 'Adjusted',
};
/**
 * Blueprint P3 "Recall trace": given a serial, show supplier receipt -> bins
 * -> transfers -> order/customer/branch -> returns/disposition, in order.
 */
function buildRecallTrace(movements) {
    return [...movements]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((movement) => ({
        at: new Date(movement.createdAt).toISOString(),
        event: EVENT_LABEL[movement.movementType] ?? movement.movementType,
        fromLocationId: movement.fromLocationId,
        toLocationId: movement.toLocationId,
        reference: movement.reference,
        actorId: movement.actorId,
    }));
}
