// Periodic-review (R, S) policy (audit R-3): the reorder system built so far (lib/replenishment.ts,
// po-planning.ts) is all continuous-review (s, S) - it reacts to today's position whenever a screen
// is opened or an order is placed. A periodic-review policy instead checks the position on a fixed
// review cycle (R days) and, when it is at or below the reorder point, orders up to a target level
// (S) that covers demand through the NEXT review plus the lead time after it - the classic shape
// used where continuous monitoring isn't practical (a weekly buy for a supplier who only ships
// once a week, a physical count cycle). This module is deliberately scoped to ONE item at ONE
// location: a full time-phased, multi-echelon DRP that cascades requirements across the whole
// network is a further, much larger increment, not attempted here.

export type ScheduledReceipt = { day: number; quantity: number };

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
  plannedOrders: Array<{ day: number; quantity: number }>;
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
export function projectPeriodicReview(input: PeriodicReviewInput): PeriodicReviewProjection {
  const demand = Math.max(0, input.avgDailyDemand);
  const receiptsByDay = new Map<number, number>();
  for (const receipt of input.scheduledReceipts ?? []) {
    receiptsByDay.set(receipt.day, (receiptsByDay.get(receipt.day) ?? 0) + receipt.quantity);
  }
  const days: PeriodicReviewDay[] = [];
  const plannedOrders: Array<{ day: number; quantity: number }> = [];
  let position = input.onHand;
  let minPosition = position;
  let firstStockoutDay: number | null = position < 0 ? 0 : null;

  for (let day = 0; day < input.horizonDays; day += 1) {
    const openingPosition = position + (receiptsByDay.get(day) ?? 0);
    position = openingPosition;
    const isReviewDay = input.reviewPeriodDays > 0 && day % input.reviewPeriodDays === 0;
    let orderedQty: number | undefined;
    if (isReviewDay && openingPosition <= input.reorderPoint) {
      const quantity = Math.max(0, input.orderUpToLevel - openingPosition);
      if (quantity > 0) {
        orderedQty = quantity;
        plannedOrders.push({ day, quantity });
        const arrivalDay = day + input.leadTimeDays;
        receiptsByDay.set(arrivalDay, (receiptsByDay.get(arrivalDay) ?? 0) + quantity);
      }
    }
    const closingPosition = position - demand;
    position = closingPosition;
    if (closingPosition < minPosition) minPosition = closingPosition;
    if (firstStockoutDay === null && closingPosition < 0) firstStockoutDay = day;
    days.push({ day, openingPosition, closingPosition, isReviewDay, orderedQty });
  }
  return { days, plannedOrders, firstStockoutDay, minPosition };
}
