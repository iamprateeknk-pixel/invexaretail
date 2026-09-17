export type ThreeWayMatchPoLine = {
    itemId: string;
    orderedQty: number;
    receivedQty: number;
    unitCost: number;
};
export type ThreeWayMatchInvoiceLine = {
    itemId: string;
    invoicedQty: number;
    unitCost: number;
};
export type ThreeWayMatchException = 'UNKNOWN_ITEM' | 'OVER_INVOICED_QTY' | 'PRICE_VARIANCE';
export type ThreeWayMatchLineResult = {
    itemId: string;
    orderedQty: number;
    receivedQty: number;
    invoicedQty: number;
    poUnitCost: number;
    invoicedUnitCost: number | null;
    exceptions: ThreeWayMatchException[];
};
export type ThreeWayMatchResult = {
    lines: ThreeWayMatchLineResult[];
    matched: boolean;
};
export declare function matchThreeWay(poLines: ThreeWayMatchPoLine[], invoiceLines: ThreeWayMatchInvoiceLine[], tolerancePercent?: number): ThreeWayMatchResult;
