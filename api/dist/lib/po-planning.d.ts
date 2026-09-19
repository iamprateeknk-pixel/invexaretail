export type PlanInput = {
    itemId: string;
    code?: string;
    name?: string;
    onHand: number;
    reserved?: number;
    minQty: number;
    targetQty: number;
    openPoQty: number;
    inTransitQty: number;
    avgDailyDemand?: number;
    demandDays?: number;
    decimal?: boolean;
    unitCost?: number;
    supplierId?: string | null;
};
export type SupplierTerms = {
    id: string;
    name: string;
    leadTimeDays?: number | null;
    moq?: number | null;
    status?: string | null;
};
export type Suggestion = {
    itemId: string;
    code?: string;
    name?: string;
    supplierId: string | null;
    supplierName: string | null;
    quantity: number;
    urgency: 'CRITICAL' | 'HIGH' | 'NORMAL';
    position: number;
    reorderPoint: number;
    orderUpTo: number;
    leadTimeDays: number;
    daysOfCover: number | null;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    estimatedCost: number | null;
    explanation: string[];
};
export type PlanResult = {
    suggestions: Suggestion[];
    skipped: Array<{
        itemId: string;
        reason: string;
    }>;
};
export declare const DEFAULT_LEAD_TIME_DAYS = 7;
export declare const DEFAULT_COVER_DAYS = 7;
export declare function planPurchases(input: {
    items: PlanInput[];
    suppliers: SupplierTerms[];
    coverDays?: number;
}): PlanResult;
export type SupplierGroup = {
    supplierId: string | null;
    supplierName: string | null;
    lines: Suggestion[];
    estimatedTotal: number;
};
/** One proposed draft PO per supplier; items with no supplier are grouped for the buyer to assign. */
export declare function groupBySupplier(suggestions: Suggestion[]): SupplierGroup[];
