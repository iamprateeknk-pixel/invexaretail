import { prisma } from './db.js';
import { thresholdsAsNumbers } from './decimal-json.js';
import { estimateValueAtRisk } from './exceptions.js';
import type { TenantContext } from './tenant-context.js';

// Blueprint Module D / section 10.2 (Count & Audit 2.0): "Tolerance can
// vary by category, value, UOM and branch" and "High-value or repeated-
// variance items automatically require recount by another user." This
// module only ever produces a *recommendation* for the human reviewer -
// matching the Exception Inbox / putaway pattern already used elsewhere in
// this app (recommend, let a person accept or dismiss) - never an
// automatic status change on the count itself.

export type ToleranceRuleLike = {
  id: string;
  label: string;
  category: string | null;
  branchId: string | null;
  valueThreshold: number | null;
  percentThreshold: number | null;
};

export type ToleranceContext = {
  category: string | null;
  branchId: string | null;
  variancePercent: number;
  varianceValue: number;
};

/**
 * Built-in tolerance used only when the company has configured NO rules at all (audit C-1):
 * before this, a company without rules got a recount recommendation only for *repeated*
 * variance, so a 40% miss on a single count produced no signal. A count is out of tolerance
 * at max(3 units, 10% of book).
 */
export const DEFAULT_TOLERANCE = { minUnits: 3, percent: 10 } as const;

export function exceedsDefaultTolerance(bookQty: number, varianceAbs: number): boolean {
  return varianceAbs >= Math.max(DEFAULT_TOLERANCE.minUnits, (Math.abs(bookQty) * DEFAULT_TOLERANCE.percent) / 100);
}

/** Pure: does this rule's scope (category/branch) apply to this count, and does its threshold trigger? */
export function ruleTriggers(rule: ToleranceRuleLike, ctx: ToleranceContext): boolean {
  const categoryMatches = rule.category === null || rule.category === ctx.category;
  const branchMatches = rule.branchId === null || rule.branchId === ctx.branchId;
  if (!categoryMatches || !branchMatches) return false;
  const valueTriggers = rule.valueThreshold !== null && ctx.varianceValue >= rule.valueThreshold;
  const percentTriggers = rule.percentThreshold !== null && ctx.variancePercent >= rule.percentThreshold;
  return valueTriggers || percentTriggers;
}

/**
 * Picks the most specific matching, triggered rule: category+branch beats
 * category-only or branch-only beats a global (both null) rule, so a
 * branch's own override always wins over a store-wide default.
 */
export function evaluateTolerance(rules: ToleranceRuleLike[], ctx: ToleranceContext): ToleranceRuleLike | null {
  const specificity = (rule: ToleranceRuleLike) => Number(rule.category !== null) + Number(rule.branchId !== null);
  const triggered = rules.filter((rule) => ruleTriggers(rule, ctx)).sort((a, b) => specificity(b) - specificity(a));
  return triggered[0] ?? null;
}

export type CountRecommendation = {
  recommendRecount: boolean;
  reason: string;
  matchedRuleId?: string;
  varianceValue: number;
  variancePercent: number;
};

/**
 * Best-effort, non-throwing: a recommendation-engine failure must never
 * block a count from being reviewed. Returns null when nothing is
 * recommended (no rule triggered and no repeated-variance pattern), so
 * callers can omit the field entirely rather than show a false negative.
 */
export async function getCountRecommendation(tenant: TenantContext, input: {
  itemId: string;
  locationId: string;
  bookQty: number;
  physicalQty: number;
}): Promise<CountRecommendation | null> {
  try {
    const variance = input.physicalQty - input.bookQty;
    const varianceAbs = Math.abs(variance);
    if (varianceAbs <= 1e-8) return null;
    const variancePercent = input.bookQty > 0 ? (varianceAbs / input.bookQty) * 100 : 100;
    const varianceValue = (await estimateValueAtRisk(tenant, input.itemId, varianceAbs)) ?? 0;

    const [item, location, rules, recentCounts] = await Promise.all([
      prisma.item.findFirst({ where: { id: input.itemId, companyId: tenant.companyId }, select: { category: true } }),
      prisma.location.findFirst({ where: { id: input.locationId, companyId: tenant.companyId }, select: { branchId: true } }),
      prisma.toleranceRule.findMany({ where: { active: true, createdBy: { companyId: tenant.companyId } } }),
      prisma.stockCount.findMany({
        where: { companyId: tenant.companyId, itemId: input.itemId, locationId: input.locationId, reviewStatus: { in: ['APPROVED', 'RECOUNT'] } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { physicalQty: true, bookQty: true },
      }),
    ]);

    const ctx: ToleranceContext = { category: item?.category ?? null, branchId: location?.branchId ?? null, variancePercent, varianceValue };
    const matched = evaluateTolerance(rules.map(thresholdsAsNumbers), ctx);
    if (matched) {
      return {
        recommendRecount: true,
        reason: `Variance ${matched.valueThreshold !== null && varianceValue >= matched.valueThreshold ? `₹${varianceValue.toFixed(0)}` : `${variancePercent.toFixed(1)}%`} exceeds the "${matched.label}" tolerance rule.`,
        matchedRuleId: matched.id,
        varianceValue,
        variancePercent,
      };
    }

    if (rules.length === 0 && exceedsDefaultTolerance(input.bookQty, varianceAbs)) {
      return {
        recommendRecount: true,
        reason: `Variance ${varianceAbs} unit(s) (${variancePercent.toFixed(1)}%) is outside the default tolerance (${DEFAULT_TOLERANCE.percent}% or ${DEFAULT_TOLERANCE.minUnits} units) - no tolerance rules are configured for this company.`,
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
  } catch (error) {
    console.error('getCountRecommendation failed (non-blocking):', error instanceof Error ? error.message : error);
    return null;
  }
}
