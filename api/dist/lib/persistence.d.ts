import type { CompanyProfileRecord, CountAssignmentRecord, CountRecord, ItemRecord, LocationRecord, TransferRecord, UserRecord } from './repository.js';
import type { AuditEvent } from './audit.js';
import type { Role } from './inventory.js';
import { type StockImportPreview } from './stock-import.js';
import type { DailyMovementRecord, LotRecord, SyncCheckpointRecord } from './repository.js';
export declare const databaseEnabled: boolean;
export type AuthenticatedUser = {
    id: string;
    email: string;
    role: Role;
    assignedLocationIds: string[];
};
export declare function authenticateUser(email: string, password: string, requestedRole?: Role): Promise<AuthenticatedUser>;
export type PersistedStockRow = {
    itemId: string;
    lotId: string;
    locationId: string;
    bookQuantity: number;
    physicalQuantity: number;
    variance: number;
    stockValue: number;
    quarantineQuantity: number;
    damagedQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
};
export declare function hydrateRepositoryFromDatabase(): Promise<void>;
export declare function hydrateAuditFromDatabase(): Promise<AuditEvent[]>;
export declare function loadTransferPickSlips(transferId: string): Promise<AuditEvent[]>;
export declare function persistItem(item: ItemRecord, companyId?: string): Promise<void>;
export type StockImportCommitResult = {
    batchId: string;
    importedItems: number;
    importedLots: number;
    importedLocations: number;
    stockRows: number;
};
/**
 * Commits a validated opening-stock workbook as an immutable snapshot and sets
 * current on-hand for each matching location/item/lot. IDs are deterministic,
 * so retrying after a network interruption cannot create duplicate masters.
 */
export declare function persistOpeningStockImport(preview: StockImportPreview, fileName: string, importedBy: string, options?: {
    batchId?: string;
    fileHash?: string;
    branchId?: string | null;
    companyId?: string;
}): Promise<StockImportCommitResult>;
export declare function persistDailyMovementImport(input: {
    batchId: string;
    importType: 'SALES' | 'PURCHASE' | 'ADJUSTMENT' | string;
    fileName: string;
    importedBy: string;
    totalRows: number;
    invalidRows: number;
    duplicateRows: number;
    transactionFrom?: string;
    transactionTo?: string;
    movements: DailyMovementRecord[];
    lots: LotRecord[];
    checkpoints: SyncCheckpointRecord[];
    fileHash?: string;
    branchId?: string | null;
    sourceFormat?: string;
    metadata?: Record<string, unknown>;
}): Promise<{
    committedRows: number;
}>;
/** Best-effort removal of a count whose sibling lots failed to save (weight counts are all-or-nothing). */
export declare function persistCountDeletion(id: string): Promise<void>;
export declare function persistCount(count: CountRecord, companyId?: string): Promise<void>;
export declare function listStockFromDatabase(locationId: string): Promise<PersistedStockRow[]>;
/**
 * Persists a count review decision. On APPROVED this also posts the
 * resulting variance to the stock ledger, in the same transaction, so the
 * count status and the on-hand quantity can never disagree.
 */
/** Writes the reconciliation state (and a recomputed book quantity) of a count. */
export declare function persistCountReconciliation(count: CountRecord): Promise<void>;
export declare function persistCountReview(count: CountRecord): Promise<void>;
export declare function persistCountAssignment(assignment: CountAssignmentRecord): Promise<void>;
export declare function persistCountAssignmentUpdate(assignment: CountAssignmentRecord): Promise<void>;
export declare function persistCountAssignmentDelete(assignmentId: string): Promise<void>;
export declare function persistAssignmentSubmitted(assignmentId: string, countId: string): Promise<void>;
export declare function persistTransfer(transfer: TransferRecord, companyId?: string): Promise<void>;
export declare function persistTransferReplacement(current: TransferRecord, next: TransferRecord): Promise<void>;
export declare function persistTransferDeletion(transfer: TransferRecord): Promise<void>;
export declare function persistTransferCarton(carton: import('./transfer-packing.js').TransferCartonRecord): Promise<void>;
/** Packing completion / dispatch details / carton count for a transfer. */
export declare function persistTransferLogistics(transfer: TransferRecord): Promise<void>;
export declare function persistTransferStatus(transfer: TransferRecord, actor: {
    id: string;
    role: Role;
    companyId: string;
}): Promise<void>;
export declare function persistConfirmedPickAllocations(transferId: string, allocations: Array<{
    itemId: string;
    lotId: string;
    locationId: string;
    quantity: number;
}>, tenant?: import('./tenant-context.js').TenantContext): Promise<void>;
export declare function persistEnterpriseUser(user: {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    role: Role;
    locationIds: string[];
    companyId?: string;
}): Promise<void>;
export declare function hydrateAuthUsers(): Promise<number>;
export declare function hydrateCompanyProfile(): Promise<void>;
export declare function persistCompanyProfile(profile: CompanyProfileRecord): Promise<void>;
export declare function persistLocationCreate(location: LocationRecord, code: string, companyId?: string): Promise<void>;
export declare function persistLocationUpdate(location: LocationRecord): Promise<void>;
export declare function persistLocationDelete(locationId: string): Promise<void>;
export declare function persistUserCreate(user: UserRecord, passwordHash: string, companyId?: string): Promise<void>;
export declare function persistUserUpdate(user: UserRecord, passwordHash?: string): Promise<void>;
export declare function persistUserDelete(userId: string): Promise<void>;
export declare function persistAudit(event: AuditEvent): Promise<void>;
