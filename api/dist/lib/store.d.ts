export type Role = 'ADMIN' | 'ADMIN_USER' | 'BRANCH_MANAGER' | 'STORE_USER' | 'WAREHOUSE_PICKER' | 'AUDITOR';
export type InventoryItemInput = {
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
};
export type InventoryLot = {
    id: string;
    itemId: string;
    lotNo: string;
    expiryDate?: string | null;
    attributes?: Record<string, unknown>;
};
export type InventoryItem = {
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
    lots: InventoryLot[];
};
export type StockCountInput = {
    itemId: string;
    lotId: string;
    locationId: string;
    physicalQuantity: number;
    mode: 'scan' | 'manual' | 'weight';
    submittedBy: string;
    role: Role;
};
export type StockCountRecord = {
    id: string;
    itemId: string;
    lotId: string;
    locationId: string;
    physicalQuantity: number;
    mode: 'scan' | 'manual' | 'weight';
    submittedBy: string;
    role: Role;
    createdAt: string;
};
export type TransferLineInput = {
    itemId: string;
    lotId: string;
    quantity: number;
};
export type TransferRequestInput = {
    sourceLocationId: string;
    destinationLocationId: string;
    requestedBy: string;
    role: Role;
    lines: TransferLineInput[];
    cartonCount?: number;
    photos?: string[];
    notes?: string;
};
export type TransferRequest = {
    id: string;
    sourceLocationId: string;
    destinationLocationId: string;
    requestedBy: string;
    role: Role;
    status: 'SUBMITTED' | 'REQUESTED' | 'PICKED' | 'DISPATCHED' | 'RECEIVED' | 'CLOSED' | 'REJECTED';
    lines: TransferLineInput[];
    cartonCount?: number;
    photos?: string[];
    notes?: string;
    createdAt: string;
};
export declare function createInventoryItem(input: InventoryItemInput): InventoryItem;
export declare function submitStockCount(input: StockCountInput): StockCountRecord;
export declare function createTransferRequest(input: TransferRequestInput): TransferRequest;
