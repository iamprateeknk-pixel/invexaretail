export type PoLine = {
    id: string;
    itemId: string;
    quantity: number;
    receivedQty: number;
    unitCost: number;
};
export type ReceiptLineInput = {
    lineId: string;
    receivedQty: number;
    damagedQty?: number;
    excessQty?: number;
    lotNo?: string | null;
    expiryDate?: string | null;
};
export type ItemRules = {
    code: string;
    lotRequired?: boolean;
    expiryRequired?: boolean;
};
export type ReceiptPosting = {
    lineId: string;
    itemId: string;
    lotNo: string;
    expiryDate: string | null;
    goodQty: number;
    damagedQty: number;
    excessQty: number;
    arrivedQty: number;
};
export type PoReceiptPlan = {
    ok: true;
    postings: ReceiptPosting[];
} | {
    ok: false;
    message: string;
    lineId?: string;
};
export declare function defaultPoLotNo(orderNumber: string): string;
export declare function planPoReceipt(input: {
    orderNumber: string;
    lines: PoLine[];
    receipt: ReceiptLineInput[];
    items: Map<string, ItemRules>;
    today?: Date;
}): PoReceiptPlan;
/** Order status after this receipt: everything ordered has arrived -> RECEIVED, otherwise still open. */
export declare function statusAfterReceipt(lines: PoLine[], postings: ReceiptPosting[]): 'RECEIVED' | 'PARTIALLY_RECEIVED';
