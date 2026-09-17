export declare function canReceiveTransfer(role: string): boolean;
export type ReceiptLineInput = {
    lineId?: string;
    itemId: string;
    lotId: string;
    receivedQty: number;
    damagedQty: number;
    shortageQty: number;
    excessQty?: number;
};
export type TransferReceiptLine = {
    id?: string;
    itemId: string;
    lotId: string;
    quantity: number;
    receivedQty?: number;
    damagedQty?: number;
    shortageQty?: number;
    excessQty?: number;
};
export declare function receiptQuantitiesMatch(expected: number, received: number, damaged: number, shortage: number, excess?: number): boolean;
export declare function validateReceiptLines(transferLines: TransferReceiptLine[], inputs: ReceiptLineInput[]): {
    receivedQty: number;
    damagedQty: number;
    shortageQty: number;
    excessQty: number;
    complete: boolean;
    hasDiscrepancy: boolean;
};
