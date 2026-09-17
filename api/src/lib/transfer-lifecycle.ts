import type { Role, TransferStatus } from './inventory.js';

export class InvalidTransferTransitionError extends Error {
  constructor(public readonly from: TransferStatus, public readonly to: TransferStatus, public readonly role?: string) {
    super(role
      ? `${role} cannot change transfer from ${from} to ${to}.`
      : `Cannot move transfer from ${from} to ${to}.`);
    this.name = 'InvalidTransferTransitionError';
  }
}

const TRANSFER_MANAGERS: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'];
const TRANSFER_CREATORS: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER'];

export function canManageTransferDispatch(role: string): boolean {
  return TRANSFER_MANAGERS.includes(role);
}

export function canCreateTransfer(role: string): boolean {
  return TRANSFER_CREATORS.includes(role);
}

const PATCH_TRANSITIONS: Record<Role, Partial<Record<TransferStatus, TransferStatus[]>>> = {
  ADMIN: {
    DRAFT: ['PENDING_PICK', 'CANCELLED'],
    PENDING_PICK: ['CANCELLED'],
    REQUESTED: ['REJECTED', 'CANCELLED'],
    PICKED: ['REJECTED', 'CANCELLED'],
    PARTIAL: ['CONFIRMED', 'CANCELLED'],
    READY_FOR_ADMIN: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['DISPATCHED', 'CANCELLED'],
    DISPATCHED: ['IN_TRANSIT'],
    RECEIVED: ['CLOSED'],
  },
  ADMIN_USER: {
    DRAFT: ['PENDING_PICK', 'CANCELLED'],
    PENDING_PICK: ['CANCELLED'],
    REQUESTED: ['REJECTED', 'CANCELLED'],
    PICKED: ['REJECTED', 'CANCELLED'],
    PARTIAL: ['CONFIRMED', 'CANCELLED'],
    READY_FOR_ADMIN: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['DISPATCHED', 'CANCELLED'],
    DISPATCHED: ['IN_TRANSIT'],
    RECEIVED: ['CLOSED'],
  },
  BRANCH_MANAGER: {
    DRAFT: ['PENDING_PICK', 'CANCELLED'],
    PENDING_PICK: ['CANCELLED'],
    REQUESTED: ['REJECTED', 'CANCELLED'],
    PICKED: ['REJECTED', 'CANCELLED'],
    PARTIAL: ['CONFIRMED', 'CANCELLED'],
    READY_FOR_ADMIN: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['DISPATCHED', 'CANCELLED'],
    DISPATCHED: ['IN_TRANSIT'],
    RECEIVED: ['CLOSED'],
  },
  STORE_USER: {},
  WAREHOUSE_PICKER: {
    REQUESTED: ['PICKING', 'PICKED'],
    PENDING_PICK: ['PICKING', 'PARTIAL', 'READY_FOR_ADMIN'],
    PICKING: ['PARTIAL', 'READY_FOR_ADMIN'],
    PARTIAL: ['PICKING', 'READY_FOR_ADMIN'],
  },
  AUDITOR: {},
};

export function allowedTransferTransitions(role: Role, from: TransferStatus): TransferStatus[] {
  return PATCH_TRANSITIONS[role][from] ?? [];
}

export function assertValidTransferTransition(role: Role, from: TransferStatus, to: TransferStatus): void {
  if (!allowedTransferTransitions(role, from).includes(to)) {
    throw new InvalidTransferTransitionError(from, to, role);
  }
}

export function parseCartonCount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('Carton count must be a whole number of at least 1.');
  }
  return count;
}

export function isReceivableStatus(status: string): boolean {
  return ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED'].includes(status);
}
