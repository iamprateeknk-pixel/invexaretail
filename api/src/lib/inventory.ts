import { assertValidTransferTransition, canCreateTransfer } from './transfer-lifecycle.js';
import { companyOwnsLocation } from './saas/tenant-scope.js';

export type Role = 'ADMIN' | 'ADMIN_USER' | 'BRANCH_MANAGER' | 'STORE_USER' | 'WAREHOUSE_PICKER' | 'AUDITOR';

export type AccessContext = {
  role: Role;
  assignedLocationIds: string[];
  companyId?: string;
};

export type StockSnapshot = {
  itemId: string;
  lotId?: string;
  locationId: string;
  bookQuantity?: number;
  physicalQuantity: number;
  variance?: number;
  stockValue?: number;
  quarantineQuantity?: number;
  damagedQuantity?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
};

export type BlindCountInput = {
  itemId: string;
  locationId: string;
  physicalQuantity: number;
  bookQuantity?: number;
  variance?: number;
  stockValue?: number;
  lotNo?: string;
  expiryDate?: string;
  mode?: 'scan' | 'manual';
  submittedBy?: string;
};

export type TransferLineInput = {
  itemId: string;
  lotId: string;
  quantity: number;
};

export type TransferInput = {
  sourceLocationId: string;
  destinationLocationId: string;
  lines: TransferLineInput[];
  notes?: string;
  cartonCount?: number;
  photos?: string[];
};

export type TransferStatus = 'SUBMITTED' | 'DRAFT' | 'PENDING_PICK' | 'REQUESTED' | 'PICKING' | 'PARTIAL' | 'PICKED' | 'READY_FOR_ADMIN' | 'CONFIRMED' | 'IN_TRANSIT' | 'DISPATCHED' | 'PARTIALLY_RECEIVED' | 'PARTIAL_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'REJECTED' | 'CANCELLED';

export function computeVariance(bookQuantity: number, physicalQuantity: number): number {
  return physicalQuantity - bookQuantity;
}

export function canAccessLocation(context: AccessContext, locationId: string): boolean {
  if (!locationId) {
    return false;
  }

  if (context.companyId && !companyOwnsLocation(context.companyId, locationId)) {
    return false;
  }

  if (context.role === 'ADMIN' || context.role === 'ADMIN_USER') {
    return true;
  }

  return context.assignedLocationIds.includes(locationId);
}

export function sanitizeStockForRole(
  role: Role,
  snapshot: StockSnapshot,
): Record<string, number | string> {
  if (role === 'STORE_USER') {
    return {
      itemId: snapshot.itemId,
      ...(snapshot.lotId ? { lotId: snapshot.lotId } : {}),
      locationId: snapshot.locationId,
      physicalQuantity: snapshot.physicalQuantity,
    };
  }

  const variance = snapshot.variance ?? computeVariance(snapshot.bookQuantity ?? 0, snapshot.physicalQuantity);

  return {
    itemId: snapshot.itemId,
    ...(snapshot.lotId ? { lotId: snapshot.lotId } : {}),
    locationId: snapshot.locationId,
    bookQuantity: snapshot.bookQuantity ?? 0,
    physicalQuantity: snapshot.physicalQuantity,
    variance,
    stockValue: snapshot.stockValue ?? 0,
    // Blueprint section 7.2: quarantine/damaged are visible to every role
    // except Store User (kept minimal by design above) so a manager can
    // see rejected stock without it inflating sellable availability.
    quarantineQuantity: snapshot.quarantineQuantity ?? 0,
    damagedQuantity: snapshot.damagedQuantity ?? 0,
    reservedQuantity: snapshot.reservedQuantity ?? 0,
    availableQuantity: snapshot.availableQuantity ?? snapshot.physicalQuantity,
  };
}

export function validateBlindCountSubmission(role: Role, input: BlindCountInput): BlindCountInput {
  if (!input?.itemId || !input?.locationId) {
    throw new Error('Item and location are required for a count submission.');
  }

  if (!Number.isFinite(input.physicalQuantity) || input.physicalQuantity < 0) {
    throw new Error('Physical quantity must be a non-negative number.');
  }

  if (role === 'STORE_USER') {
    if ('bookQuantity' in input && input.bookQuantity !== undefined) {
      throw new Error('Store users cannot submit book quantity in blind counts.');
    }

    if ('variance' in input && input.variance !== undefined) {
      throw new Error('Store users cannot submit variance values in blind counts.');
    }

    if ('stockValue' in input && input.stockValue !== undefined) {
      throw new Error('Store users cannot submit stock value in blind counts.');
    }
  }

  const normalized: BlindCountInput = {
    ...input,
    physicalQuantity: Number(input.physicalQuantity),
  };

  if (typeof input.bookQuantity === 'number') {
    normalized.variance = computeVariance(input.bookQuantity, normalized.physicalQuantity);
  }

  return normalized;
}

export function validateTransferRequest(role: Role, input: TransferInput): TransferInput {
  if (!canCreateTransfer(role)) {
    throw new Error('Only admins, branch managers or store users can create transfer requests.');
  }

  if (!input.sourceLocationId || !input.destinationLocationId) {
    throw new Error('Source and destination locations are required.');
  }

  if (input.sourceLocationId === input.destinationLocationId) {
    throw new Error('A transfer cannot have the same source and destination.');
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('At least one transfer line is required.');
  }

  for (const line of input.lines) {
    if (!line.itemId || !line.lotId) {
      throw new Error('Each transfer line requires an item and lot.');
    }

    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error('Transfer quantities must be positive numbers.');
    }
  }

  return { ...input, lines: input.lines.map((line) => ({ ...line, quantity: Number(line.quantity) })) };
}

export function validateTransferStatusChange(
  role: Role,
  currentStatus: TransferStatus,
  nextStatus: TransferStatus,
): void {
  assertValidTransferTransition(role, currentStatus, nextStatus);
}
