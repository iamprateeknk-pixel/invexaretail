import type { TenantContext } from './tenant-context.js';
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
/** Pure: does this rule's scope (category/branch) apply to this count, and does its threshold trigger? */
export declare function ruleTriggers(rule: ToleranceRuleLike, ctx: ToleranceContext): boolean;
/**
 * Picks the most specific matching, triggered rule: category+branch beats
 * category-only or branch-only beats a global (both null) rule, so a
 * branch's own override always wins over a store-wide default.
 */
export declare function evaluateTolerance(rules: ToleranceRuleLike[], ctx: ToleranceContext): ToleranceRuleLike | null;
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
export declare function getCountRecommendation(tenant: TenantContext, input: {
    itemId: string;
    locationId: string;
    bookQty: number;
    physicalQty: number;
}): Promise<CountRecommendation | null>;
