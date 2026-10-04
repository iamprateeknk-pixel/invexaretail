export type SellableRow = {
    onHand: number;
    reserved?: number;
    lot?: {
        status?: string | null;
        expiryDate?: Date | string | null;
    } | null;
};
export declare function sellableQuantity(row: SellableRow, now?: Date): number;
export declare function totalSellable(rows: SellableRow[], now?: Date): number;
/** On-hand and reserved restricted to lots that can be sold (for callers that show both). */
export declare function sellableParts(rows: SellableRow[], now?: Date): {
    onHand: number;
    reserved: number;
};
