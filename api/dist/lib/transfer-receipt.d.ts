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
export declare function persistTransferReceipt(input: {
    requestId: string;
    transferId: string;
    destinationLocationId: string;
    receivedById: string;
    notes: string;
    lines: ReceiptLineInput[];
}): Promise<PersistedReceiptResult | null>;
export {};
