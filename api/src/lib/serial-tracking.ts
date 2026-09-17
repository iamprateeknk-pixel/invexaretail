// Blueprint P3 "Traceability 3.0": serial movement must reconcile with the
// stock ledger and can never create stock the ledger does not own - so this
// module never touches Prisma directly. It only decides whether a status
// transition is legal and shapes the movement row the caller should persist
// alongside its own stock-ledger write. Persistence lives in the route.

export type SerialStatus = 'IN_STOCK' | 'RESERVED' | 'SOLD' | 'RETURNED' | 'DAMAGED' | 'LOST';
export type SerialMovementType = 'RECEIVE' | 'TRANSFER' | 'PICK' | 'PACK' | 'SALE' | 'RETURN' | 'ADJUSTMENT';

// A serial unit can be in only one physical inventory state at a time
// (blueprint §20 invariant) - this table is the single source of truth for
// which transitions are legal, so no caller can sidestep it.
const VALID_TRANSITIONS: Record<SerialStatus, SerialStatus[]> = {
  IN_STOCK: ['IN_STOCK', 'RESERVED', 'SOLD', 'DAMAGED', 'LOST'],
  RESERVED: ['IN_STOCK', 'SOLD', 'DAMAGED', 'LOST'],
  SOLD: ['RETURNED'],
  RETURNED: ['IN_STOCK', 'DAMAGED'],
  DAMAGED: ['IN_STOCK', 'LOST'],
  LOST: ['IN_STOCK'],
};

export class SerialTransitionError extends Error {
  constructor(from: SerialStatus, to: SerialStatus) {
    super(`Serial cannot move from ${from} to ${to}.`);
    this.name = 'SerialTransitionError';
  }
}

export function assertValidSerialTransition(from: SerialStatus, to: SerialStatus): void {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new SerialTransitionError(from, to);
  }
}

export type PlannedSerialMovement = {
  movementType: SerialMovementType;
  fromLocationId: string | null;
  toLocationId: string | null;
  fromStatus: SerialStatus;
  toStatus: SerialStatus;
  reference: string | null;
  actorId: string | null;
};

export function planSerialMovement(input: {
  currentStatus: SerialStatus;
  toStatus: SerialStatus;
  movementType: SerialMovementType;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reference?: string | null;
  actorId?: string | null;
}): PlannedSerialMovement {
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

const EVENT_LABEL: Record<SerialMovementType, string> = {
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
export function buildRecallTrace(movements: SerialMovementRecord[]): TraceStep[] {
  return [...movements]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((movement) => ({
      at: new Date(movement.createdAt).toISOString(),
      event: EVENT_LABEL[movement.movementType as SerialMovementType] ?? movement.movementType,
      fromLocationId: movement.fromLocationId,
      toLocationId: movement.toLocationId,
      reference: movement.reference,
      actorId: movement.actorId,
    }));
}
