export type Role = 'ADMIN' | 'ADMIN_USER' | 'BRANCH_MANAGER' | 'STORE_USER' | 'WAREHOUSE_PICKER' | 'AUDITOR';
export type DailyMovementRecord = { id: string; dedupeKey: string; itemId: string; lotId?: string; locationId: string; movementType: string; qtyDelta: number; transactionAt: string; sourceType: 'SALES' | 'PURCHASE' | 'ADJUSTMENT'; sourceReference: string; importBatchId?: string; createdById: string; metadata?: Record<string, unknown> };
export type SyncCheckpointRecord = { locationId: string; sourceType: 'SALES' | 'PURCHASE'; syncedThroughAt: string; lastImportBatchId: string };

export type LocationRecord = {
  id: string;
  name: string;
  type: 'store' | 'warehouse';
  /** Admin-chosen display order (lower first); absent means 0, i.e. creation order. */
  sortOrder?: number;
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
  // Blueprint v4 §6 canonical Item Master - see lib/item-master.ts.
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  archiveReason?: string;
  archivedAt?: string;
  archivedById?: string;
  barcode?: string;
  hsn?: string;
  gstRate?: number;
  mrp?: number;
  leadTimeDays?: number;
  shelfLifeDays?: number;
  aliases?: string[];
  version?: number;
  createdById?: string;
  updatedById?: string;
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
  mode: 'scan' | 'manual' | 'weight';
  submittedBy: string;
  role: Role;
  createdAt: string;
  requestId?: string;
  status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RECOUNT';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewReason?: string;
  reasonCode?: string;
  parentCountId?: string;
  varianceMovementId?: string;
  // Blueprint v4 §14 - see lib/late-movements.ts.
  reconciliationRequired?: boolean;
  reconciliationNote?: string;
  reconciliationAt?: string;
  bookQtyOriginal?: number;
  lateDelta?: number;
  lateMovementKeys?: string[];
  // Bare-id call-site migration slice 8: the in-memory mirror carried no
  // company identifier at all, so core.ts's bare-id lookups depended
  // entirely on the separate in-memory location-ownership map (via
  // canAccessLocation) for tenant isolation, not a real field on the
  // record itself - see docs/tenant-scope-coverage.md.
  companyId?: string;
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
  campaignId?: string;
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
  // Blueprint v4 §16: set once every expected line is covered by sealed cartons.
  packing?: { completedAt: string; completedById: string; cartonCount: number };
  // Blueprint v4 §17: set at dispatch.
  dispatch?: { dispatchedAt: string; dispatchedById: string; carrier?: string; awb?: string; vehicleNo?: string; expectedArrivalAt?: string };
  // The picker an admin/branch manager assigned. Unset: any picker at the source location may pick.
  assignedPickerId?: string;
  createdAt: string;
  // Bare-id call-site migration slice 8: the in-memory mirror carried no
  // company identifier at all, so core.ts's bare-id lookups depended
  // entirely on the separate in-memory location-ownership map (via
  // canAccessLocation) for tenant isolation, not a real field on the
  // record itself - see docs/tenant-scope-coverage.md.
  companyId?: string;
};

import type { StockMovementRecord } from './stock-ledger.js';
import type { TransferCartonRecord } from './transfer-packing.js';
import { seedCounts, seedItems, seedLocations, seedStockLedger, seedTransfers, seedUsers } from './seed.js';

export type CompanyProfileRecord = {
  name: string;
  email?: string;
  phone?: string;
  industry?: string;
  industryKey?: string;
  address?: string;
};

// The default company's profile (the platform's own company, and what a single-company deployment uses).
// Every other company has its own profile in `otherCompanyProfiles`: this used to be ONE profile for the whole
// process, so the Admin of any company read it, and could overwrite it, for every company.
export const companyProfile: CompanyProfileRecord = { name: 'InvexaRetail', industry: 'Grocery', industryKey: 'grocery' };
const otherCompanyProfiles = new Map<string, CompanyProfileRecord>();
const DEFAULT_PROFILE_COMPANY = 'default-company';

export function getCompanyProfile(): CompanyProfileRecord {
  return { ...companyProfile };
}

export function setCompanyProfile(update: CompanyProfileRecord): CompanyProfileRecord {
  Object.assign(companyProfile, update);
  return { ...companyProfile };
}

/** A company's own profile, or undefined when it has none yet (never another company's). */
export function findCompanyProfile(companyId: string): CompanyProfileRecord | undefined {
  if (companyId === DEFAULT_PROFILE_COMPANY) return { ...companyProfile };
  const own = otherCompanyProfiles.get(companyId);
  return own ? { ...own } : undefined;
}

/** Replaces one company's profile; no other company is touched. */
export function saveCompanyProfile(companyId: string, profile: CompanyProfileRecord): CompanyProfileRecord {
  if (companyId === DEFAULT_PROFILE_COMPANY) return setCompanyProfile(profile);
  otherCompanyProfiles.set(companyId, { ...profile });
  return { ...profile };
}

export const locations: LocationRecord[] = [...seedLocations];

export const items: ItemRecord[] = [...seedItems];

export const counts: CountRecord[] = [...seedCounts];

export const transfers: TransferRecord[] = [...seedTransfers];
export const transferCartons: TransferCartonRecord[] = [];

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

/**
 * Applies a patch to the stored item. listItems() hands out copies, so edits
 * made to one of those never reach the repository - always go through here.
 */
export function updateItemRecord(id: string, patch: Partial<Omit<ItemRecord, 'id' | 'lots'>>): ItemRecord | undefined {
  const stored = items.find((candidate) => candidate.id === id);
  if (!stored) return undefined;
  Object.assign(stored, patch);
  return { ...stored, lots: [...stored.lots] };
}

export function createItemRecord(input: { code: string; name: string; category?: string; subcategory?: string; company?: string; unit?: string; countMethod?: ItemRecord['countMethod']; pickMethod?: ItemRecord['pickMethod']; allocationStrategy?: ItemRecord['allocationStrategy']; lotRequired?: boolean; expiryRequired?: boolean; decimalQuantity?: boolean; barcode?: string; hsn?: string; gstRate?: number; mrp?: number; leadTimeDays?: number; shelfLifeDays?: number; aliases?: string[]; createdById?: string }): ItemRecord {
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
    status: 'ACTIVE',
    barcode: input.barcode,
    hsn: input.hsn,
    gstRate: input.gstRate,
    mrp: input.mrp,
    leadTimeDays: input.leadTimeDays,
    shelfLifeDays: input.shelfLifeDays,
    aliases: input.aliases,
    version: 1,
    createdById: input.createdById,
    updatedById: input.createdById,
    lots: [{ id: lotId, itemId, lotNo: 'LOT-DEFAULT', expiryDate: null, attributes: { source: 'created' } }],
  };

  items.push(item);
  return { ...item, lots: [...item.lots] };
}

export function upsertItemRecord(input: { code: string; name: string; category?: string; subcategory?: string; company?: string; unit?: string }, isOwned?: (item: ItemRecord) => boolean): { item: ItemRecord; created: boolean } {
  // `isOwned` limits the match to the caller's own items: matching by code across the whole process let one company's import
  // overwrite another company's item with the same code.
  const existing = items.find((item) => item.code.trim().toLowerCase() === input.code.trim().toLowerCase() && (!isOwned || isOwned(item)));
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
// A checkpoint only ever moves forward: backfilling an older day's file must
// not make the branch look less synced than it already was.
export function upsertSyncCheckpoint(input: SyncCheckpointRecord): SyncCheckpointRecord {
  const current = syncCheckpoints.find((entry) => entry.locationId === input.locationId && entry.sourceType === input.sourceType);
  if (!current) { syncCheckpoints.push({ ...input }); return { ...input }; }
  if (input.syncedThroughAt > current.syncedThroughAt) Object.assign(current, input);
  return { ...current };
}
export function listSyncCheckpoints(): SyncCheckpointRecord[] { return syncCheckpoints.map((entry) => ({ ...entry })); }

export function createCountRecord(input: CountRecord): CountRecord {
  const record = { status: 'PENDING_REVIEW' as const, ...input };
  counts.push(record);
  return { ...record };
}

/** Undoes createCountRecord when the database write behind it failed. */
export function removeCountRecord(id: string): void {
  const index = counts.findIndex((row) => row.id === id);
  if (index >= 0) counts.splice(index, 1);
}

export function listCounts(): CountRecord[] {
  return [...counts];
}

/**
 * Bare-id call-site migration slice 9 (see docs/tenant-scope-coverage.md):
 * a companyId-scoped lookup for core.ts's many bare-id count lookups, as
 * an independent second layer alongside the location-ownership check
 * they already sit behind. Fail-safe-if-unknown, same shape as Week 27's
 * centralized canAccessLocation fix: a record whose companyId is known
 * and mismatches the caller's is denied; a record with no companyId yet
 * (created before this field existed, or by a path this migration hasn't
 * reached) falls through unchanged, so this can never cause a false deny
 * on data the field hasn't reached yet.
 */
export function findCountForCompany(id: string, companyId: string): CountRecord | undefined {
  const count = counts.find((row) => row.id === id);
  if (!count) return undefined;
  if (count.companyId && count.companyId !== companyId) return undefined;
  return { ...count };
}

export function createTransferRecord(input: TransferRecord): TransferRecord {
  transfers.push(input);
  return { ...input, lines: input.lines.map((line) => ({ ...line })) };
}

export function replaceTransferRecord(id: string, input: TransferRecord): TransferRecord {
  const index = transfers.findIndex((record) => record.id === id);
  if (index < 0) throw new Error('Transfer was not found.');
  transfers[index] = { ...input, lines: input.lines.map((line) => ({ ...line })) };
  return { ...transfers[index], lines: transfers[index].lines.map((line) => ({ ...line })) };
}

export function removeTransferRecord(id: string): TransferRecord | undefined {
  const index = transfers.findIndex((record) => record.id === id);
  if (index < 0) return undefined;
  const [removed] = transfers.splice(index, 1);
  return { ...removed, lines: removed.lines.map((line) => ({ ...line })) };
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
  reasonCode?: string,
): CountRecord {
  const count = counts.find((record) => record.id === id);
  if (!count) throw new Error('Stock count was not found.');
  if (count.status !== 'PENDING_REVIEW') throw new Error(`Count is already ${count.status} and cannot be reviewed again.`);

  count.status = status;
  count.reviewedBy = reviewedBy;
  count.reviewedAt = new Date().toISOString();
  if (reviewReason) count.reviewReason = reviewReason;
  if (reasonCode) count.reasonCode = reasonCode;

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
    campaignId: previous?.campaignId,
  });
  return { assignment, cancelled: previous ? { ...previous } : undefined };
}

export function updateCountAssignment(id: string, patch: Partial<Pick<CountAssignmentRecord, 'assignedToId' | 'countDate' | 'dueDate' | 'priority' | 'instructions' | 'status'>>): CountAssignmentRecord {
  const assignment = countAssignments.find((row) => row.id === id);
  if (!assignment) throw new Error('Count assignment was not found.');
  Object.assign(assignment, patch);
  return { ...assignment };
}

/** Removes an assignment while preserving any StockCount it may have created. */
export function deleteCountAssignment(id: string): CountAssignmentRecord {
  const index = countAssignments.findIndex((row) => row.id === id);
  if (index === -1) throw new Error('Count assignment was not found.');
  const [removed] = countAssignments.splice(index, 1);
  return { ...removed };
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

export function listTransferCartons(transferId?: string): TransferCartonRecord[] {
  return transferCartons
    .filter((carton) => !transferId || carton.transferId === transferId)
    .map((carton) => ({ ...carton, lines: carton.lines.map((line) => ({ ...line })) }));
}

export function addTransferCarton(carton: TransferCartonRecord): TransferCartonRecord {
  transferCartons.push({ ...carton, lines: carton.lines.map((line) => ({ ...line })) });
  return { ...carton, lines: carton.lines.map((line) => ({ ...line })) };
}

export function setTransferCartonStatus(id: string, status: TransferCartonRecord['status']): TransferCartonRecord | undefined {
  const carton = transferCartons.find((row) => row.id === id);
  if (!carton) return undefined;
  carton.status = status;
  return { ...carton, lines: carton.lines.map((line) => ({ ...line })) };
}

/** Records packing completion and/or dispatch details on the stored transfer. */
export function setTransferLogistics(id: string, patch: Pick<TransferRecord, 'packing' | 'dispatch' | 'cartonCount'>): TransferRecord {
  const transfer = transfers.find((record) => record.id === id);
  if (!transfer) throw new Error('Transfer was not found.');
  if (patch.packing !== undefined) transfer.packing = patch.packing;
  if (patch.dispatch !== undefined) transfer.dispatch = patch.dispatch;
  if (patch.cartonCount !== undefined) transfer.cartonCount = patch.cartonCount;
  return { ...transfer, lines: transfer.lines.map((line) => ({ ...line })) };
}

export function setTransferAssignedPicker(id: string, pickerId: string | undefined): TransferRecord {
  const transfer = transfers.find((record) => record.id === id);
  if (!transfer) throw new Error('Transfer was not found.');
  if (pickerId) transfer.assignedPickerId = pickerId;
  else delete transfer.assignedPickerId;
  return { ...transfer, lines: transfer.lines.map((line) => ({ ...line })) };
}

export function listTransfers(): TransferRecord[] {
  return transfers.map((transfer) => ({ ...transfer, lines: transfer.lines.map((line) => ({ ...line })) }));
}

/** Same fail-safe-if-unknown companyId scoping as findCountForCompany, for Transfer. */
export function findTransferForCompany(id: string, companyId: string): TransferRecord | undefined {
  const transfer = transfers.find((record) => record.id === id);
  if (!transfer) return undefined;
  if (transfer.companyId && transfer.companyId !== companyId) return undefined;
  return { ...transfer, lines: transfer.lines.map((line) => ({ ...line })) };
}
