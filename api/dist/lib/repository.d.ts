export type Role = 'ADMIN' | 'ADMIN_USER' | 'BRANCH_MANAGER' | 'STORE_USER' | 'WAREHOUSE_PICKER' | 'AUDITOR';
export type DailyMovementRecord = {
    id: string;
    dedupeKey: string;
    itemId: string;
    lotId?: string;
    locationId: string;
    movementType: string;
    qtyDelta: number;
    transactionAt: string;
    sourceType: 'SALES' | 'PURCHASE' | 'ADJUSTMENT';
    sourceReference: string;
    importBatchId?: string;
    createdById: string;
    metadata?: Record<string, unknown>;
};
export type SyncCheckpointRecord = {
    locationId: string;
    sourceType: 'SALES' | 'PURCHASE';
    syncedThroughAt: string;
    lastImportBatchId: string;
};
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
    countMethod?: 'LOT_SCAN' | 'ITEM_WEIGHT';
    pickMethod?: 'LOT_SCAN' | 'ITEM_QTY_FIFO';
    allocationStrategy?: 'FIFO' | 'FEFO';
    lotRequired?: boolean;
    expiryRequired?: boolean;
    decimalQuantity?: boolean;
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
    reconciliationRequired?: boolean;
    reconciliationNote?: string;
    reconciliationAt?: string;
    bookQtyOriginal?: number;
    lateDelta?: number;
    lateMovementKeys?: string[];
};
export type StockLedgerRecord = {
    itemId: string;
    lotId: string;
    locationId: string;
    onHand: number;
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
    lines: Array<{
        itemId: string;
        lotId: string;
        quantity: number;
        receivedQty?: number;
        damagedQty?: number;
        shortageQty?: number;
        excessQty?: number;
    }>;
    cartonCount?: number;
    photos?: string[];
    notes?: string;
    createdAt: string;
};
import type { StockMovementRecord } from './stock-ledger.js';
export type CompanyProfileRecord = {
    name: string;
    email?: string;
    phone?: string;
    industry?: string;
    industryKey?: string;
    address?: string;
};
export declare const companyProfile: CompanyProfileRecord;
export declare function getCompanyProfile(): CompanyProfileRecord;
export declare function setCompanyProfile(update: CompanyProfileRecord): CompanyProfileRecord;
export declare const locations: LocationRecord[];
export declare const items: ItemRecord[];
export declare const counts: CountRecord[];
export declare const transfers: TransferRecord[];
export declare const stockLedger: StockLedgerRecord[];
export declare const countAssignments: CountAssignmentRecord[];
export declare const stockMovements: StockMovementRecord[];
export declare const users: UserRecord[];
export declare const dailyMovements: DailyMovementRecord[];
export declare const syncCheckpoints: SyncCheckpointRecord[];
export declare function findUserById(id: string): UserRecord | undefined;
export declare function listUsers(): UserRecord[];
export declare function findStockLedgerEntry(itemId: string, lotId: string, locationId: string): StockLedgerRecord | undefined;
export declare function listStockLedgerForLocation(locationId: string): StockLedgerRecord[];
export declare function listStockLedger(): StockLedgerRecord[];
/** Applies a signed delta to on-hand quantity, creating the row if it does not exist yet. Not safe for concurrent callers within one process tick. */
export declare function adjustStockLedger(itemId: string, lotId: string, locationId: string, delta: number): StockLedgerRecord;
/**
 * Applies a signed delta to the quarantine bucket - damaged/rejected stock
 * that is physically present but not sellable (blueprint section 7.2).
 * A positive delta receives stock into quarantine (e.g. a damaged receiving
 * line); a negative delta releases it out (an Exception Inbox disposition:
 * back to on-hand, or removed entirely for destroy/vendor-return).
 */
export declare function adjustQuarantineLedger(itemId: string, lotId: string, locationId: string, delta: number): StockLedgerRecord;
export declare function listLocations(): LocationRecord[];
export declare function listItems(): ItemRecord[];
/**
 * Applies a patch to the stored item. listItems() hands out copies, so edits
 * made to one of those never reach the repository - always go through here.
 */
export declare function updateItemRecord(id: string, patch: Partial<Omit<ItemRecord, 'id' | 'lots'>>): ItemRecord | undefined;
export declare function createItemRecord(input: {
    code: string;
    name: string;
    category?: string;
    subcategory?: string;
    company?: string;
    unit?: string;
    countMethod?: ItemRecord['countMethod'];
    pickMethod?: ItemRecord['pickMethod'];
    allocationStrategy?: ItemRecord['allocationStrategy'];
    lotRequired?: boolean;
    expiryRequired?: boolean;
    decimalQuantity?: boolean;
    barcode?: string;
    hsn?: string;
    gstRate?: number;
    mrp?: number;
    leadTimeDays?: number;
    shelfLifeDays?: number;
    aliases?: string[];
    createdById?: string;
}): ItemRecord;
export declare function upsertItemRecord(input: {
    code: string;
    name: string;
    category?: string;
    subcategory?: string;
    company?: string;
    unit?: string;
}): {
    item: ItemRecord;
    created: boolean;
};
export declare function ensureLotRecord(itemId: string, lotNo: string, expiryDate?: string | null, attributes?: Record<string, unknown>, id?: string): LotRecord;
export declare function updateLotStatus(lotId: string, status: NonNullable<LotRecord['status']>): LotRecord;
export declare function updateLotExpiry(lotId: string, expiryDate: string | null): LotRecord;
export declare function recordDailyMovement(input: DailyMovementRecord): DailyMovementRecord;
export declare function listDailyMovements(): DailyMovementRecord[];
export declare function upsertSyncCheckpoint(input: SyncCheckpointRecord): SyncCheckpointRecord;
export declare function listSyncCheckpoints(): SyncCheckpointRecord[];
export declare function createCountRecord(input: CountRecord): CountRecord;
export declare function listCounts(): CountRecord[];
export declare function createTransferRecord(input: TransferRecord): TransferRecord;
export declare function listStockMovements(filter?: {
    itemId?: string;
    locationId?: string;
    sourceDocument?: string;
}): StockMovementRecord[];
export declare function updateCountReview(id: string, status: 'APPROVED' | 'REJECTED' | 'RECOUNT', reviewedBy: string, reviewReason?: string): CountRecord;
export declare function findPendingCountForLot(userId: string, itemId: string, lotId: string, locationId: string): CountRecord | undefined;
export declare function findAssignmentForCount(countId: string): CountAssignmentRecord | undefined;
export declare function createCountAssignment(input: Omit<CountAssignmentRecord, 'status' | 'createdAt'>): CountAssignmentRecord;
export declare function createRecountAssignment(count: CountRecord, reviewedBy: string): {
    assignment: CountAssignmentRecord;
    cancelled?: CountAssignmentRecord;
};
export declare function updateCountAssignment(id: string, patch: Partial<Pick<CountAssignmentRecord, 'assignedToId' | 'countDate' | 'dueDate' | 'priority' | 'instructions' | 'status'>>): CountAssignmentRecord;
export declare function listCountAssignments(): CountAssignmentRecord[];
export declare function listCountAssignmentsFor(userId: string): CountAssignmentRecord[];
/** The one open (ASSIGNED) assignment matching this user/item/location, if any. */
export declare function findActiveAssignment(userId: string, itemId: string, locationId: string): CountAssignmentRecord | undefined;
export declare function markAssignmentSubmitted(id: string, countId: string): void;
export declare function updateTransferStatus(id: string, status: TransferRecord['status']): TransferRecord;
export declare function updateTransferReceiptProgress(id: string, lines: Array<{
    itemId: string;
    lotId: string;
    quantity: number;
    receivedQty?: number;
    damagedQty?: number;
    shortageQty?: number;
    excessQty?: number;
}>): TransferRecord;
export declare function listTransfers(): TransferRecord[];
