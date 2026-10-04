export type SalesEvent = {
    itemId: string;
    /** Net units: a sale is positive, a return is negative. */
    qty: number;
    timestamp: Date;
};
export declare function signedSalesQty(movementType: string, qtyDelta: number): number;
export declare function loadSalesEvents(input: {
    since: Date;
    companyId?: string;
    locationId?: string;
    itemIds?: string[];
    limit?: number;
}): Promise<SalesEvent[]>;
/** Total net units sold per item. */
export declare function totalsByItem(events: SalesEvent[]): Map<string, number>;
