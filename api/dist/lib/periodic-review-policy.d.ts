export type ScheduledReceipt = {
    day: number;
    quantity: number;
};
export type PeriodicReviewPolicy = {
    reviewPeriodDays: number;
    leadTimeDays: number;
    /** Protection interval = leadTimeDays + reviewPeriodDays: between one review and the next order's arrival, nothing can be ordered again. */
    protectionIntervalDays: number;
    safetyStock: number;
    /** Order-up-to level (S): expected demand over the protection interval, plus safety stock. */
    orderUpToLevel: number;
    /** Reorder point (s): textbook (R,S) orders at every review unless already at/above S, so this equals orderUpToLevel - a caller may lower it to skip small top-ups (a hybrid (R,s,S) policy, same shape projectPeriodicReview already simulates). */
    reorderPoint: number;
};
/**
 * Computes the (R,S) policy's own R-day review-cycle parameters from demand/lead-time inputs -
 * the second half of "periodic review" this module was missing: projectPeriodicReview could only
 * simulate a given R/S, not derive S from real demand statistics the way computeSafetyStock
 * already does for continuous review. Same King's-formula safety stock, with the protection
 * interval (lead time + review period, not lead time alone) standing in for "lead time": between
 * one review and the arrival of the order it might trigger, nothing can be ordered again, so the
 * position must be protected for that whole stretch, not just the supplier's lead time.
 */
export declare function computePeriodicReviewPolicy(input: {
    avgDailyDemand: number;
    stdDevDailyDemand: number;
    leadTimeDays: number;
    leadTimeStdDevDays?: number;
    reviewPeriodDays: number;
    servicePercent?: number;
}): PeriodicReviewPolicy;
export type PeriodicReviewInput = {
    /** Current sellable position (on hand minus reserved), day 0. */
    onHand: number;
    /** Average daily demand, already net of returns/seasonality upstream (demand-forecast.ts). */
    avgDailyDemand: number;
    /** Supplier lead time in whole days. */
    leadTimeDays: number;
    /** How often the position is reviewed and an order can be placed, in whole days. */
    reviewPeriodDays: number;
    /** Reorder point: order when the position at a review falls to or below this. */
    reorderPoint: number;
    /** Order-up-to level: a triggered order brings the position (after the order arrives) to this. */
    orderUpToLevel: number;
    /** Receipts already scheduled to land on a given day (open POs/transfers), day 0 = today. */
    scheduledReceipts?: ScheduledReceipt[];
    /** How many days forward to simulate. */
    horizonDays: number;
};
export type PeriodicReviewDay = {
    day: number;
    /** Position at the START of the day, before that day's demand is taken out. */
    openingPosition: number;
    /** Position at the END of the day (after demand and any receipt that landed today). */
    closingPosition: number;
    isReviewDay: boolean;
    /** Set on a review day when the position triggered an order. */
    orderedQty?: number;
};
export type PeriodicReviewProjection = {
    days: PeriodicReviewDay[];
    /** Every day an order was triggered, with its quantity. */
    plannedOrders: Array<{
        day: number;
        quantity: number;
    }>;
    /** The first day the projected position goes negative (a stockout), or null if it never does within the horizon. */
    firstStockoutDay: number | null;
    /** Lowest position reached anywhere in the horizon (can be negative - a projected shortage). */
    minPosition: number;
};
/**
 * Simulates one item/location under a periodic-review (R, S) policy. A review on day `d` (d = 0,
 * R, 2R, ...) orders when the OPENING position that day (before demand is removed) is at or below
 * the reorder point; the order quantity is `orderUpToLevel - openingPosition`, arriving after
 * `leadTimeDays` and added to `scheduledReceipts` for that arrival day (so a later review already
 * sees it as incoming, and never double-orders for the same need).
 */
export declare function projectPeriodicReview(input: PeriodicReviewInput): PeriodicReviewProjection;
