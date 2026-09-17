"use strict";
// Blueprint P7 "Vendor score: fill rate, lead time, price variance, quality
// rejects, short/excess receipts, on-time delivery." Deterministic, no ML -
// every number here is a plain aggregate over the supplier's own purchase
// order history, so a buyer can see exactly why a vendor scored the way it
// did.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeVendorScore = computeVendorScore;
exports.computePriceVariance = computePriceVariance;
function computeVendorScore(orders, quality) {
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
    const onTime = completedWithExpectation.filter((order) => new Date(order.completedAt).getTime() <= new Date(order.expectedAt).getTime());
    const onTimeDeliveryPercent = completedWithExpectation.length > 0 ? (onTime.length / completedWithExpectation.length) * 100 : 0;
    const completedWithLeadTime = orders.filter((order) => order.completedAt);
    const leadTimes = completedWithLeadTime.map((order) => (new Date(order.completedAt).getTime() - new Date(order.createdAt).getTime()) / (24 * 60 * 60 * 1000));
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
function computePriceVariance(pricesByDate) {
    if (pricesByDate.length < 2)
        return null;
    const sorted = [...pricesByDate].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const earliest = sorted[0].unitCost;
    const latest = sorted[sorted.length - 1].unitCost;
    const variancePercent = earliest !== 0 ? ((latest - earliest) / earliest) * 100 : 0;
    return { earliest, latest, variancePercent };
}
