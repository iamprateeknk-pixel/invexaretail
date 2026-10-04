export declare const COUNT_REASON_CODES: readonly ["THEFT_SHRINKAGE", "DAMAGE", "EXPIRY_WRITE_OFF", "RECEIVING_ERROR", "PICKING_ERROR", "MISCOUNT", "SYSTEM_TIMING", "SUPPLIER_SHORTAGE", "OTHER"];
export type CountReasonCode = (typeof COUNT_REASON_CODES)[number];
/** Undefined/empty -> undefined (optional); anything else must be one of the codes. */
export declare function parseCountReasonCode(value: unknown): CountReasonCode | undefined;
/** Units and count of variances per code, worst absolute impact first; uncoded variances are reported as UNCODED. */
export declare function summarizeVarianceReasons(counts: Array<{
    physicalQty: number;
    bookQty: number;
    reasonCode?: string | null;
}>): {
    counts: number;
    absoluteUnits: number;
    netUnits: number;
    reasonCode: string;
}[];
/**
 * Count accuracy the way inventory managers report it (audit C-3): a count is accurate when its
 * variance is inside tolerance (not only when it is exactly equal), and accuracy is also weighed by
 * money so a 1-unit miss on an expensive item is not the same as one on a cheap item.
 * `unitCost` null = uncosted: it counts toward the unit figures and is left out of the value ones.
 */
type AccuracyCount = {
    physicalQty: number;
    bookQty: number;
    unitCost?: number | null;
    abcClass?: string | null;
};
/** Same summary, plus a per-ABC-class breakdown when the counts carry a class (A items matter most; a blended 95% can hide a 70% on A). */
export declare function summarizeCountAccuracyByClass(counts: AccuracyCount[], tolerance: {
    minUnits: number;
    percent: number;
}): {
    byClass: Record<string, {
        counts: number;
        withinTolerance: number;
        accuracyPercent: number;
        costedCounts: number;
        varianceValue: number;
        /** 100 - variance value as a share of the counted book value; null when nothing costed was counted. */
        valueAccuracyPercent: number;
    }>;
    counts: number;
    withinTolerance: number;
    accuracyPercent: number;
    costedCounts: number;
    varianceValue: number;
    /** 100 - variance value as a share of the counted book value; null when nothing costed was counted. */
    valueAccuracyPercent: number;
};
export declare function summarizeCountAccuracy(counts: AccuracyCount[], tolerance: {
    minUnits: number;
    percent: number;
}): {
    counts: number;
    withinTolerance: number;
    accuracyPercent: number;
    costedCounts: number;
    varianceValue: number;
    /** 100 - variance value as a share of the counted book value; null when nothing costed was counted. */
    valueAccuracyPercent: number;
};
export {};
