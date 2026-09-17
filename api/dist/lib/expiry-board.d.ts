export type ExpiryHorizon = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'UPCOMING' | 'DATED' | 'MISSING';
export interface ExpiryBoardLot {
    id: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    category: string;
    subcategory: string;
    company: string;
    unit: string;
    lotId: string;
    lotNo: string;
    lotStatus: string;
    locationId: string;
    quantity: number;
    expiryDate: string | null;
    daysUntilExpiry: number | null;
    horizon: ExpiryHorizon;
    recommendedAction: string;
    purchaseValue: number | null;
    saleValue: number | null;
}
export interface ExpiryBoardSummary {
    expiredLots: number;
    expiredQty: number;
    expiredValue: number;
    criticalLots: number;
    criticalQty: number;
    warningLots: number;
    warningQty: number;
    upcomingLots: number;
    upcomingQty: number;
    datedLots: number;
    missingLots: number;
    missingQty: number;
    atRiskLots: number;
    atRiskQty: number;
    atRiskValue: number;
    datedOnHandLots: number;
}
export interface ExpiryBoard {
    lots: ExpiryBoardLot[];
    summary: ExpiryBoardSummary;
    categories: string[];
}
export interface ExpiryBoardItemInput {
    id: string;
    code?: string | null;
    name?: string | null;
    category?: string | null;
    subcategory?: string | null;
    company?: string | null;
    unit?: string | null;
}
export interface ExpiryBoardLotInput {
    id: string;
    lotNo: string;
    expiryDate?: string | Date | null;
    status?: string | null;
    attributes?: Record<string, unknown> | null;
}
export interface ExpiryBoardStockInput {
    itemId: string;
    lotId: string;
    locationId: string;
    quantity: number;
}
export declare function emptyExpiryBoard(): ExpiryBoard;
export declare function calendarDaysUntilExpiry(expiryDate: string | Date | null | undefined, now?: Date): number | null;
export declare function classifyExpiryHorizon(daysUntilExpiry: number | null): ExpiryHorizon;
export declare function recommendedExpiryActionForHorizon(horizon: ExpiryHorizon): string;
export declare function estimateLotValue(attributes: Record<string, unknown> | null | undefined, quantity: number): number | null;
export declare function matchesExpiryHorizon(horizon: ExpiryHorizon, filter: string): boolean;
export declare function buildExpiryBoard(input: {
    items: ExpiryBoardItemInput[];
    lots: ExpiryBoardLotInput[];
    stock: ExpiryBoardStockInput[];
    now?: Date;
}): ExpiryBoard;
