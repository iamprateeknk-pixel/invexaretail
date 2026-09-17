"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruleTriggers = ruleTriggers;
exports.evaluateTolerance = evaluateTolerance;
exports.getCountRecommendation = getCountRecommendation;
const db_js_1 = require("./db.js");
const exceptions_js_1 = require("./exceptions.js");
/** Pure: does this rule's scope (category/branch) apply to this count, and does its threshold trigger? */
function ruleTriggers(rule, ctx) {
    const categoryMatches = rule.category === null || rule.category === ctx.category;
    const branchMatches = rule.branchId === null || rule.branchId === ctx.branchId;
    if (!categoryMatches || !branchMatches)
        return false;
    const valueTriggers = rule.valueThreshold !== null && ctx.varianceValue >= rule.valueThreshold;
    const percentTriggers = rule.percentThreshold !== null && ctx.variancePercent >= rule.percentThreshold;
    return valueTriggers || percentTriggers;
}
/**
 * Picks the most specific matching, triggered rule: category+branch beats
 * category-only or branch-only beats a global (both null) rule, so a
 * branch's own override always wins over a store-wide default.
 */
function evaluateTolerance(rules, ctx) {
    const specificity = (rule) => Number(rule.category !== null) + Number(rule.branchId !== null);
    const triggered = rules.filter((rule) => ruleTriggers(rule, ctx)).sort((a, b) => specificity(b) - specificity(a));
    return triggered[0] ?? null;
}
/**
 * Best-effort, non-throwing: a recommendation-engine failure must never
 * block a count from being reviewed. Returns null when nothing is
 * recommended (no rule triggered and no repeated-variance pattern), so
 * callers can omit the field entirely rather than show a false negative.
 */
async function getCountRecommendation(input) {
    try {
        const variance = input.physicalQty - input.bookQty;
        const varianceAbs = Math.abs(variance);
        if (varianceAbs <= 1e-8)
            return null;
        const variancePercent = input.bookQty > 0 ? (varianceAbs / input.bookQty) * 100 : 100;
        const varianceValue = (await (0, exceptions_js_1.estimateValueAtRisk)(input.itemId, varianceAbs)) ?? 0;
        const [item, location, rules, recentCounts] = await Promise.all([
            db_js_1.prisma.item.findUnique({ where: { id: input.itemId }, select: { category: true } }),
            db_js_1.prisma.location.findUnique({ where: { id: input.locationId }, select: { branchId: true } }),
            db_js_1.prisma.toleranceRule.findMany({ where: { active: true } }),
            db_js_1.prisma.stockCount.findMany({
                where: { itemId: input.itemId, locationId: input.locationId, reviewStatus: { in: ['APPROVED', 'RECOUNT'] } },
                orderBy: { createdAt: 'desc' },
                take: 3,
                select: { physicalQty: true, bookQty: true },
            }),
        ]);
        const ctx = { category: item?.category ?? null, branchId: location?.branchId ?? null, variancePercent, varianceValue };
        const matched = evaluateTolerance(rules, ctx);
        if (matched) {
            return {
                recommendRecount: true,
                reason: `Variance ${matched.valueThreshold !== null && varianceValue >= matched.valueThreshold ? `₹${varianceValue.toFixed(0)}` : `${variancePercent.toFixed(1)}%`} exceeds the "${matched.label}" tolerance rule.`,
                matchedRuleId: matched.id,
                varianceValue,
                variancePercent,
            };
        }
        // Repeated-variance (blueprint: "High-value or repeated-variance items
        // automatically require recount by another user"): 2 of the last 3
        // counts for this item/location (including this one) already varied.
        const priorVarianceCount = recentCounts.filter((count) => Math.abs(count.physicalQty - count.bookQty) > 1e-8).length;
        if (priorVarianceCount >= 1) {
            return {
                recommendRecount: true,
                reason: `This item/location has varied in ${priorVarianceCount + 1} of its last ${recentCounts.length + 1} counts - repeated variance.`,
                varianceValue,
                variancePercent,
            };
        }
        return null;
    }
    catch (error) {
        console.error('getCountRecommendation failed (non-blocking):', error instanceof Error ? error.message : error);
        return null;
    }
}
