// Blueprint P7 "Vendor score: fill rate, lead time, price variance, quality
// rejects, short/excess receipts, on-time delivery." Deterministic, no ML -
// every number here is a plain aggregate over the supplier's own purchase
// order history, so a buyer can see exactly why a vendor scored the way it
// did.

export type VendorScoreOrder = {
  quantity: number;
  receivedQty: number;
  expectedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /** When the order was actually placed with the supplier (sent, else approved). Lead time is measured from here, not from the draft. */
  orderedAt?: string | null;
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

export function computeVendorScore(orders: VendorScoreOrder[], quality?: VendorQualityInput): VendorScoreResult {
  if (!orders.length) {
    return {
      ordersConsidered: 0, fillRatePercent: 0, onTimeDeliveryPercent: 0,
      averageLeadTimeDays: null, shortReceiptCount: 0, excessReceiptCount: 0,
      qualityRejectRatePercent: quality && quality.totalInspections > 0 ? (quality.failedInspections / quality.totalInspections) * 100 : null,
    };
  }

  const totalOrdered = orders.reduce((sum, order) => sum + order.quantity, 0);
  const totalReceived = orders.reduce((sum, order) => sum + Math.min(order.receivedQty, order.quantity), 0);
  const fillRatePercent = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;

  const shortReceiptCount = orders.filter((order) => order.receivedQty < order.quantity).length;
  const excessReceiptCount = orders.filter((order) => order.receivedQty > order.quantity).length;

  const completedWithExpectation = orders.filter((order) => order.completedAt && order.expectedAt);
  const onTime = completedWithExpectation.filter((order) => new Date(order.completedAt!).getTime() <= new Date(order.expectedAt!).getTime());
  const onTimeDeliveryPercent = completedWithExpectation.length > 0 ? (onTime.length / completedWithExpectation.length) * 100 : 0;

  const completedWithLeadTime = orders.filter((order) => order.completedAt);
  const leadTimes = completedWithLeadTime.map((order) => (new Date(order.completedAt!).getTime() - new Date(order.orderedAt ?? order.createdAt).getTime()) / (24 * 60 * 60 * 1000));
  const averageLeadTimeDays = leadTimes.length > 0 ? leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length : null;

  return {
    ordersConsidered: orders.length,
    fillRatePercent,
    onTimeDeliveryPercent,
    averageLeadTimeDays,
    shortReceiptCount,
    excessReceiptCount,
    qualityRejectRatePercent: quality && quality.totalInspections > 0 ? (quality.failedInspections / quality.totalInspections) * 100 : null,
  };
}

/**
 * Price variance: how much a supplier's per-unit price for the same item
 * has moved since the earliest recorded price - a rising trend flags a
 * vendor whose pricing is drifting, without hiding it behind a single
 * average.
 */
export function computePriceVariance(pricesByDate: Array<{ unitCost: number; at: string }>): { earliest: number; latest: number; variancePercent: number } | null {
  if (pricesByDate.length < 2) return null;
  const sorted = [...pricesByDate].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const earliest = sorted[0].unitCost;
  const latest = sorted[sorted.length - 1].unitCost;
  const variancePercent = earliest !== 0 ? ((latest - earliest) / earliest) * 100 : 0;
  return { earliest, latest, variancePercent };
}


export type SupplierLeadTime = { samples: number; meanDays: number | null; stdDevDays: number | null };

/**
 * Measured supplier lead time (audit O-3): placed -> last goods received, mean and standard
 * deviation over completed orders. Safety stock needs the VARIABILITY as much as the mean; the
 * planner used a fixed number and assumed zero variability.
 */
export function supplierLeadTimeStats(orders: Array<Pick<VendorScoreOrder, 'completedAt' | 'createdAt' | 'orderedAt'>>): SupplierLeadTime {
  const days = orders
    .filter((order) => order.completedAt)
    .map((order) => (new Date(order.completedAt!).getTime() - new Date(order.orderedAt ?? order.createdAt).getTime()) / 86_400_000)
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!days.length) return { samples: 0, meanDays: null, stdDevDays: null };
  const mean = days.reduce((sum, value) => sum + value, 0) / days.length;
  const variance = days.length > 1 ? days.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (days.length - 1) : 0;
  return { samples: days.length, meanDays: Math.round(mean * 100) / 100, stdDevDays: Math.round(Math.sqrt(variance) * 100) / 100 };
}
