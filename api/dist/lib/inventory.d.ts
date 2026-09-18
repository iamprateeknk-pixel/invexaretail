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
export declare function computeVariance(bookQuantity: number, physicalQuantity: number): number;
export declare function canAccessLocation(context: AccessContext, locationId: string): boolean;
export declare function hidesZeroStockForRole(role: Role): boolean;
export type ItemOperationalMeta = {
    countMethod?: 'LOT_SCAN' | 'ITEM_WEIGHT';
    pickMethod?: 'LOT_SCAN' | 'ITEM_QTY_FIFO';
    allocationStrategy?: 'FIFO' | 'FEFO';
    lotRequired?: boolean;
    expiryRequired?: boolean;
    decimalQuantity?: boolean;
};
export declare function parseItemOperationalMeta(body: Record<string, unknown>): ItemOperationalMeta;
export declare function sanitizeStockForRole(role: Role, snapshot: StockSnapshot): Record<string, number | string>;
export declare function validateBlindCountSubmission(role: Role, input: BlindCountInput): BlindCountInput;
export declare function validateTransferRequest(role: Role, input: TransferInput): TransferInput;
export declare function validateTransferStatusChange(role: Role, currentStatus: TransferStatus, nextStatus: TransferStatus): void;
