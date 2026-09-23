import { type ReceiptLineInput } from './receipt-validation.js';
type DbTransferLine = {
    id: string;
    itemId: string;
    lotId: string;
    requestedQty: number;
    receivedQty: number;
    damagedQty: number;
    shortageQty: number;
    excessQty: number;
};
export type PersistedReceiptResult = {
    duplicate: boolean;
    status: 'RECEIVED' | 'PARTIAL_RECEIVED';
    receiptId: string;
    receivedQty: number;
    damagedQty: number;
    shortageQty: number;
    excessQty: number;
    lines: DbTransferLine[];
};
export type StoredReceipt = {
    requestId: string;
    transferId: string;
    receiptId?: string;
    status: 'RECEIVED' | 'PARTIAL_RECEIVED';
    receivedBy?: string;
    receivedAt: string;
    receivedQty: number;
    damagedQty: number;
    shortageQty: number;
    excessQty: number;
    notes?: string;
};
export declare function rememberReceipt(receipt: StoredReceipt): void;
/** Claims a requestId for the duration of one request; false while another identical request is running. */
export declare function beginReceiptRequest(requestId: string): boolean;
export declare function endReceiptRequest(requestId: string): void;
export declare function findReceiptByRequestId(requestId: string): Promise<StoredReceipt | null>;
export declare function persistTransferReceipt(input: {
    requestId: string;
    transferId: string;
    destinationLocationId: string;
    receivedById: string;
    notes: string;
    lines: ReceiptLineInput[];
}): Promise<PersistedReceiptResult | null>;
export {};
