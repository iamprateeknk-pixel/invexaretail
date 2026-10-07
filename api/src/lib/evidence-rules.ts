import { prisma } from './db.js';
import { thresholdsAsNumbers } from './decimal-json.js';
import { estimateValueAtRisk } from './exceptions.js';
import { listTransferEvidence } from './transfer-evidence.js';
import type { TenantContext } from './tenant-context.js';

// Blueprint section 16.2, third named workflow example: "damaged receipt >
// threshold -> photo mandatory." Distinct from ToleranceRule (recommend
// only) and ApprovalRule (gates on a human decision): this gates on a fact
// that must already exist - at least one evidence photo already uploaded
// for the transfer - before the receipt with damage can be posted.

export type EvidenceRuleLike = {
  id: string;
  label: string;
  category: string | null;
  branchId: string | null;
  quantityThreshold: number | null;
  valueThreshold: number | null;
};

export type EvidenceContext = {
  category: string | null;
  branchId: string | null;
  quantity: number;
  value: number;
};

/** Pure: does this rule's scope (category/branch) apply, and does either independent threshold trigger? Same shape as ToleranceRule's ruleTriggers(). */
export function ruleTriggers(rule: EvidenceRuleLike, ctx: EvidenceContext): boolean {
  const categoryMatches = rule.category === null || rule.category === ctx.category;
  const branchMatches = rule.branchId === null || rule.branchId === ctx.branchId;
  if (!categoryMatches || !branchMatches) return false;
  const quantityTriggers = rule.quantityThreshold !== null && ctx.quantity >= rule.quantityThreshold;
  const valueTriggers = rule.valueThreshold !== null && ctx.value >= rule.valueThreshold;
  return quantityTriggers || valueTriggers;
}

/** Picks the most specific matching, triggered rule: category+branch beats category-only or branch-only beats a global (both null) rule. */
export function findTriggeredEvidenceRule<T extends EvidenceRuleLike>(rules: T[], ctx: EvidenceContext): T | null {
  const specificity = (rule: T) => Number(rule.category !== null) + Number(rule.branchId !== null);
  const triggered = rules.filter((rule) => ruleTriggers(rule, ctx)).sort((a, b) => specificity(b) - specificity(a));
  return triggered[0] ?? null;
}

export type EvidenceGateResult =
  | { blocked: false }
  | { blocked: true; reason: string; matchedRuleId: string };

/**
 * Checks whether a damaged receipt line is gated by an active EvidenceRule
 * and, if so, whether evidence already exists for the transfer. Never
 * throws (a rule-engine failure must not block the underlying receipt from
 * at least attempting its normal path) - returns `{ blocked: false }` on
 * any internal error, same fail-open posture as checkApprovalGate /
 * getCountRecommendation elsewhere in this app.
 */
export async function requireEvidenceForDamage(tenant: TenantContext, input: {
  transferId: string;
  triggerType: string;
  itemId: string;
  branchId: string | null;
  damagedQty: number;
}): Promise<EvidenceGateResult> {
  try {
    const [item, rules, damagedValue] = await Promise.all([
      prisma.item.findFirst({ where: { id: input.itemId, companyId: tenant.companyId }, select: { category: true } }),
      prisma.evidenceRule.findMany({ where: { triggerType: input.triggerType, active: true, createdBy: { companyId: tenant.companyId } } }),
      estimateValueAtRisk(tenant, input.itemId, input.damagedQty),
    ]);
    if (rules.length === 0) return { blocked: false };

    const ctx: EvidenceContext = { category: item?.category ?? null, branchId: input.branchId, quantity: input.damagedQty, value: damagedValue ?? 0 };
    const matched = findTriggeredEvidenceRule(rules.map(thresholdsAsNumbers), ctx);
    if (!matched) return { blocked: false };

    const existing = await listTransferEvidence(input.transferId);
    if (Array.isArray(existing) && existing.length > 0) return { blocked: false };

    return {
      blocked: true,
      matchedRuleId: matched.id,
      reason: `Attach at least one evidence photo before receiving - ${input.damagedQty} damaged unit(s) exceeds the "${matched.label}" threshold.`,
    };
  } catch (error) {
    console.error('requireEvidenceForDamage failed (fail-open, non-blocking):', error instanceof Error ? error.message : error);
    return { blocked: false };
  }
}
