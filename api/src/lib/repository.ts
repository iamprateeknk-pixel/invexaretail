export type Role = 'ADMIN' | 'ADMIN_USER' | 'BRANCH_MANAGER' | 'STORE_USER' | 'WAREHOUSE_PICKER' | 'AUDITOR';
export type DailyMovementRecord = { id: string; dedupeKey: string; itemId: string; lotId?: string; locationId: string; movementType: string; qtyDelta: number; transactionAt: string; sourceType: 'SALES' | 'PURCHASE' | 'ADJUSTMENT'; sourceReference: string; importBatchId?: string; createdById: string; metadata?: Record<string, unknown> };
export type SyncCheckpointRecord = { locationId: string; sourceType: 'SALES' | 'PURCHASE'; syncedThroughAt: string; lastImportBatchId: string };

export type LocationRecord = {
  id: string;
  name: string;
  type: 'store' | 'warehouse';
};

export type ItemRecord = {
  id: string;
  code: string;
  name: string;
  category?: string;
  subcategory?: string;
  company?: string;
  unit?: string;
  // Blueprint v4 §6 operational metadata - see schema.prisma Item for field docs.
  countMethod?: 'LOT_SCAN' | 'ITEM_WEIGHT';
  pickMethod?: 'LOT_SCAN' | 'ITEM_QTY_FIFO';
  allocationStrategy?: 'FIFO' | 'FEFO';
  lotRequired?: boolean;
  expiryRequired?: boolean;
  decimalQuantity?: boolean;
  lots: LotRecord[];
};

export type LotRecord = {
  id: string;
  itemId: string;
  lotNo: string;
  expiryDate?: string | null;
  status?: 'AVAILABLE' | 'EXPIRED' | 'BLOCKED' | 'QUARANTINE';
  attributes?: Record<string, unknown>;
};

export type CountRecord = {
  id: string;
  itemId: string;
  lotId: string;
  locationId: string;
  physicalQuantity: number;
  bookQty: number;
  mode: 'scan' | 'manual';
  submittedBy: string;
  role: Role;
  createdAt: string;
  status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RECOUNT';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewReason?: string;
  parentCountId?: string;
  varianceMovementId?: string;
};

export type StockLedgerRecord = {
  itemId: string;
  lotId: string;
  locationId: string;
  onHand: number;
  // Blueprint section 7.2: quarantine/damaged stock is physically present
  // but excluded from sellable on-hand math elsewhere in this file.
  quarantine: number;
  version: number;
};

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: Role;
  assignedLocationIds: string[];
};

export type CountAssignmentRecord = {
  id: string;
  locationId: string;
  itemId: string;
  assignedToId: string;
  assignedById: string;
  countDate: string;
  dueDate?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH';
  instructions?: string;
  status: 'ASSIGNED' | 'SUBMITTED' | 'CANCELLED';
  countId?: string;
  parentCountId?: string;
  createdAt: string;
};

export type TransferRecord = {
  id: string;
  sourceLocationId: string;
  destinationLocationId: string;
  requestedBy: string;
  role: Role;
  status: 'SUBMITTED' | 'DRAFT' | 'PENDING_PICK' | 'REQUESTED' | 'PICKING' | 'PARTIAL' | 'PICKED' | 'READY_FOR_ADMIN' | 'CONFIRMED' | 'IN_TRANSIT' | 'DISPATCHED' | 'PARTIALLY_RECEIVED' | 'PARTIAL_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'REJECTED' | 'CANCELLED';
  lines: Array<{ itemId: string; lotId: string; quantity: number; receivedQty?: number; damagedQty?: number; shortageQty?: number; excessQty?: number }>;
  cartonCount?: number;
  photos?: string[];
  notes?: string;
  createdAt: string;
};

import type { StockMovementRecord } from './stock-ledger.js';
import { seedCounts, seedItems, seedLocations, seedStockLedger, seedTransfers, seedUsers } from './seed.js';

export type CompanyProfileRecord = {
  name: string;
  email?: string;
  phone?: string;
  industry?: string;
  industryKey?: string;
  address?: string;
};

// Single-tenant: one profile for the whole deployment, not one per company.
export const companyProfile: CompanyProfileRecord = { name: 'InvexaRetail', industry: 'Grocery', industryKey: 'grocery' };

export function getCompanyProfile(): CompanyProfileRecord {
  return { ...companyProfile };
}

export function setCompanyProfile(update: CompanyProfileRecord): CompanyProfileRecord {
  Object.assign(companyProfile, update);
  return { ...companyProfile };
}

export const locations: LocationRecord[] = [...seedLocations];

export const items: ItemRecord[] = [...seedItems];

export const counts: CountRecord[] = [...seedCounts];

export const transfers: TransferRecord[] = [...seedTransfers];

export const stockLedger: StockLedgerRecord[] = [...seedStockLedger];

export const countAssignments: CountAssignmentRecord[] = [];

export const stockMovements: StockMovementRecord[] = [];

export const users: UserRecord[] = seedUsers.map((user) => ({ id: user.id, email: user.email, name: user.name, role: user.role, assignedLocationIds: user.assignedLocationIds }));
export const dailyMovements: DailyMovementRecord[] = [];
export const syncCheckpoints: SyncCheckpointRecord[] = [];

export function findUserById(id: string): UserRecord | undefined {
  return users.find((user) => user.id === id);
}

export function listUsers(): UserRecord[] {
  return [...users];
}

export function findStockLedgerEntry(itemId: string, lotId: string, locationId: string): StockLedgerRecord | undefined {
  return stockLedger.find((row) => row.itemId === itemId && row.lotId === lotId && row.locationId === locationId);
}

export function listStockLedgerForLocation(locationId: string): StockLedgerRecord[] {
  return stockLedger.filter((row) => row.locationId === locationId).map((row) => ({ ...row }));
}

export function listStockLedger(): StockLedgerRecord[] {
  return stockLedger.map((row) => ({ ...row }));
}

function findOrCreateStockLedgerRow(itemId: string, lotId: string, locationId: string): StockLedgerRecord {
  let row = stockLedger.find((entry) => entry.itemId === itemId && entry.lotId === lotId && entry.locationId === locationId);
  if (!row) {
    row = { itemId, lotId, locationId, onHand: 0, quarantine: 0, version: 0 };
    stockLedger.push(row);
  }
  return row;
}

/** Applies a signed delta to on-hand quantity, creating the row if it does not exist yet. Not safe for concurrent callers within one process tick. */
export function adjustStockLedger(itemId: string, lotId: string, locationId: string, delta: number): StockLedgerRecord {
  const row = findOrCreateStockLedgerRow(itemId, lotId, locationId);
  row.onHand += delta;
  row.version += 1;
  return { ...row };
}

/**
 * Applies a signed delta to the quarantine bucket - damaged/rejected stock
 * that is physically present but not sellable (blueprint section 7.2).
 * A positive delta receives stock into quarantine (e.g. a damaged receiving
 * line); a negative delta releases it out (an Exception Inbox disposition:
 * back to on-hand, or removed entirely for destroy/vendor-return).
 */
export function adjustQuarantineLedger(itemId: string, lotId: string, locationId: string, delta: number): StockLedgerRecord {
  const row = findOrCreateStockLedgerRow(itemId, lotId, locationId);
  row.quarantine = Math.max(0, row.quarantine + delta);
  row.version += 1;
  return { ...row };
}

export function listLocations(): LocationRecord[] {
  return [...locations];
}

export function listItems(): ItemRecord[] {
  return items.map((item) => ({
    ...item,
    lots: [...item.lots],
  }));
}

export function createItemRecord(input: { code: string; name: string; category?: string; subcategory?: string; company?: string; unit?: string; countMethod?: ItemRecord['countMethod']; pickMethod?: ItemRecord['pickMethod']; allocationStrategy?: ItemRecord['allocationStrategy']; lotRequired?: boolean; expiryRequired?: boolean; decimalQuantity?: boolean }): ItemRecord {
  const itemId = `item-${Math.random().toString(36).slice(2, 8)}`;
  const lotId = `lot-${Math.random().toString(36).slice(2, 8)}`;

  const item: ItemRecord = {
    id: itemId,
    code: input.code,
    name: input.name,
    category: input.category,
    subcategory: input.subcategory,
    company: input.company,
    unit: input.unit,
    countMethod: input.countMethod,
    pickMethod: input.pickMethod,
    allocationStrategy: input.allocationStrategy,
    lotRequired: input.lotRequired,
    expiryRequired: input.expiryRequired,
    decimalQuantity: input.decimalQuantity,
    lots: [{ id: lotId, itemId, lotNo: 'LOT-DEFAULT', expiryDate: null, attributes: { source: 'created' } }],
  };

  items.push(item);
  return { ...item, lots: [...item.lots] };
}

export function upsertItemRecord(input: { code: string; name: string; category?: string; subcategory?: string; company?: string; unit?: string }): { item: ItemRecord; created: boolean } {
  const existing = items.find((item) => item.code.trim().toLowerCase() === input.code.trim().toLowerCase());
  if (existing) {
    existing.name = input.name;
    existing.category = input.category;
    existing.subcategory = input.subcategory;
    existing.company = input.company;
    existing.unit = input.unit;
    return { item: { ...existing, lots: [...existing.lots] }, created: false };
  }
  return { item: createItemRecord(input), created: true };
}

export function ensureLotRecord(itemId: string, lotNo: string, expiryDate?: string | null, attributes?: Record<string, unknown>, id?: string): LotRecord {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) throw new Error('Item was not found.');
  const existing = item.lots.find((lot) => lot.lotNo.trim().toLowerCase() === lotNo.trim().toLowerCase());
  if (existing) return { ...existing };
  const lot: LotRecord = { id: id ?? `lot-${Math.random().toString(36).slice(2, 10)}`, itemId, lotNo, expiryDate: expiryDate ?? null, status: 'AVAILABLE', attributes };
  item.lots.push(lot);
  return { ...lot };
}

export function updateLotStatus(lotId: string, status: NonNullable<LotRecord['status']>): LotRecord {
  for (const item of items) {
    const lot = item.lots.find((entry) => entry.id === lotId);
    if (!lot) continue;
    lot.status = status;
    return { ...lot };
  }
  throw new Error('Lot was not found.');
}

export function updateLotExpiry(lotId: string, expiryDate: string | null): LotRecord {
  for (const item of items) {
    const lot = item.lots.find((entry) => entry.id === lotId);
    if (!lot) continue;
    lot.expiryDate = expiryDate;
    return { ...lot };
  }
  throw new Error('Lot was not found.');
}

export function recordDailyMovement(input: DailyMovementRecord): DailyMovementRecord { dailyMovements.push(input); return { ...input }; }
export function listDailyMovements(): DailyMovementRecord[] { return dailyMovements.map((entry) => ({ ...entry })); }
export function upsertSyncCheckpoint(input: SyncCheckpointRecord): SyncCheckpointRecord { const current = syncCheckpoints.find((entry) => entry.locationId === input.locationId && entry.sourceType === input.sourceType); if (current) Object.assign(current, input); else syncCheckpoints.push(input); return { ...input }; }
export function listSyncCheckpoints(): SyncCheckpointRecord[] { return syncCheckpoints.map((entry) => ({ ...entry })); }

export function createCountRecord(input: CountRecord): CountRecord {
  const record = { status: 'PENDING_REVIEW' as const, ...input };
  counts.push(record);
  return { ...record };
}

export function listCounts(): CountRecord[] {
  return [...counts];
}

export function createTransferRecord(input: TransferRecord): TransferRecord {
  transfers.push(input);
  return { ...input, lines: input.lines.map((line) => ({ ...line })) };
}

function makeMovementId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listStockMovements(filter?: { itemId?: string; locationId?: string; sourceDocument?: string }): StockMovementRecord[] {
  return stockMovements
    .filter((movement) => {
      if (filter?.itemId && movement.itemId !== filter.itemId) return false;
      if (filter?.locationId && movement.locationId !== filter.locationId) return false;
      if (filter?.sourceDocument && movement.sourceDocument !== filter.sourceDocument) return false;
      return true;
    })
    .map((movement) => ({ ...movement }));
}

export function updateCountReview(
  id: string,
  status: 'APPROVED' | 'REJECTED' | 'RECOUNT',
  reviewedBy: string,
  reviewReason?: string,
): CountRecord {
  const count = counts.find((record) => record.id === id);
  if (!count) throw new Error('Stock count was not found.');
  if (count.status !== 'PENDING_REVIEW') throw new Error(`Count is already ${count.status} and cannot be reviewed again.`);

  count.status = status;
  count.reviewedBy = reviewedBy;
  count.reviewedAt = new Date().toISOString();
  if (reviewReason) count.reviewReason = reviewReason;

  if (status === 'APPROVED') {
    const variance = count.physicalQuantity - count.bookQty;
    const before = findStockLedgerEntry(count.itemId, count.lotId, count.locationId)?.onHand ?? count.bookQty;
    adjustStockLedger(count.itemId, count.lotId, count.locationId, variance);
    const after = before + variance;
    const movement: StockMovementRecord = {
      id: makeMovementId('mv'),
      itemId: count.itemId,
      lotId: count.lotId,
      locationId: count.locationId,
      movementType: 'COUNT_VARIANCE',
      qtyDelta: variance,
      beforeBalance: before,
      afterBalance: after,
      sourceDocument: count.id,
      sourceLineId: count.id,
      actor: reviewedBy,
      timestamp: count.reviewedAt,
      correlationId: count.id,
      reason: reviewReason,
      metadata: { countId: count.id, physicalQuantity: count.physicalQuantity, bookQty: count.bookQty },
    };
    stockMovements.push(movement);
    count.varianceMovementId = movement.id;
  }

  return { ...count };
}

export function findPendingCountForLot(userId: string, itemId: string, lotId: string, locationId: string): CountRecord | undefined {
  return counts.find((count) =>
    count.submittedBy === userId
    && count.itemId === itemId
    && count.lotId === lotId
    && count.locationId === locationId
    && (count.status ?? 'PENDING_REVIEW') === 'PENDING_REVIEW');
}

export function findAssignmentForCount(countId: string): CountAssignmentRecord | undefined {
  return countAssignments.find((row) => row.countId === countId);
}

export function createCountAssignment(input: Omit<CountAssignmentRecord, 'status' | 'createdAt'>): CountAssignmentRecord {
  const record: CountAssignmentRecord = {
    status: 'ASSIGNED',
    createdAt: new Date().toISOString(),
    priority: 'NORMAL',
    ...input,
  };
  countAssignments.push(record);
  return { ...record };
}

export function createRecountAssignment(count: CountRecord, reviewedBy: string): { assignment: CountAssignmentRecord; cancelled?: CountAssignmentRecord } {
  const previous = findAssignmentForCount(count.id)
    ?? countAssignments.find((row) =>
      row.assignedToId === count.submittedBy
      && row.itemId === count.itemId
      && row.locationId === count.locationId
      && row.status === 'SUBMITTED');
  if (previous && previous.status !== 'CANCELLED') {
    previous.status = 'CANCELLED';
  }
  const assignment = createCountAssignment({
    id: `assign-${Math.random().toString(36).slice(2, 10)}`,
    locationId: count.locationId,
    itemId: count.itemId,
    assignedToId: previous?.assignedToId ?? count.submittedBy,
    assignedById: reviewedBy,
    countDate: new Date().toISOString(),
    dueDate: previous?.dueDate,
    priority: previous?.priority ?? 'HIGH',
    instructions: count.reviewReason ? `Recount: ${count.reviewReason}` : previous?.instructions,
    parentCountId: count.id,
  });
  return { assignment, cancelled: previous ? { ...previous } : undefined };
}

export function updateCountAssignment(id: string, patch: Partial<Pick<CountAssignmentRecord, 'assignedToId' | 'countDate' | 'dueDate' | 'priority' | 'instructions' | 'status'>>): CountAssignmentRecord {
  const assignment = countAssignments.find((row) => row.id === id);
  if (!assignment) throw new Error('Count assignment was not found.');
  Object.assign(assignment, patch);
  return { ...assignment };
}

export function listCountAssignments(): CountAssignmentRecord[] {
  return [...countAssignments];
}

export function listCountAssignmentsFor(userId: string): CountAssignmentRecord[] {
  return countAssignments.filter((row) => row.assignedToId === userId && row.status === 'ASSIGNED').map((row) => ({ ...row }));
}

/** The one open (ASSIGNED) assignment matching this user/item/location, if any. */
export function findActiveAssignment(userId: string, itemId: string, locationId: string): CountAssignmentRecord | undefined {
  return countAssignments.find((row) => row.assignedToId === userId && row.itemId === itemId && row.locationId === locationId && row.status === 'ASSIGNED');
}

export function markAssignmentSubmitted(id: string, countId: string): void {
  const assignment = countAssignments.find((row) => row.id === id);
  if (assignment) {
    assignment.status = 'SUBMITTED';
    assignment.countId = countId;
  }
}

export function updateTransferStatus(id: string, status: TransferRecord['status']): TransferRecord {
  const transfer = transfers.find((record) => record.id === id);
  if (!transfer) throw new Error('Transfer was not found.');

  transfer.status = status;
  return { ...transfer, lines: transfer.lines.map((line) => ({ ...line })) };
}

export function updateTransferReceiptProgress(
  id: string,
  lines: Array<{ itemId: string; lotId: string; quantity: number; receivedQty?: number; damagedQty?: number; shortageQty?: number; excessQty?: number }>,
): TransferRecord {
  const transfer = transfers.find((record) => record.id === id);
  if (!transfer) throw new Error('Transfer was not found.');
  transfer.lines = lines.map((line) => ({ ...line }));
  return { ...transfer, lines: transfer.lines.map((line) => ({ ...line })) };
}

export function listTransfers(): TransferRecord[] {
  return transfers.map((transfer) => ({ ...transfer, lines: transfer.lines.map((line) => ({ ...line })) }));
}
