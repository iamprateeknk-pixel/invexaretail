export type VendorScoreOrder = {
    quantity: number;
    receivedQty: number;
    expectedAt: string | null;
    completedAt: string | null;
    createdAt: string;
};
export type VendorQualityInput = {
    totalInspections: number;
    failedInspections: number;
};
export type VendorScoreResult = {
    ordersConsidered: number;
    fillRatePercent: number;
    onTimeDeliveryPercent: number;
    averageLeadTimeDays: number | null;
    shortReceiptCount: number;
    excessReceiptCount: number;
    qualityRejectRatePercent: number | null;
};
export declare function computeVendorScore(orders: VendorScoreOrder[], quality?: VendorQualityInput): VendorScoreResult;
/**
 * Price variance: how much a supplier's per-unit price for the same item
 * has moved since the earliest recorded price - a rising trend flags a
 * vendor whose pricing is drifting, without hiding it behind a single
 * average.
 */
export declare function computePriceVariance(pricesByDate: Array<{
    unitCost: number;
    at: string;
}>): {
    earliest: number;
    latest: number;
    variancePercent: number;
} | null;
