"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruleTriggers = ruleTriggers;
exports.findTriggeredEvidenceRule = findTriggeredEvidenceRule;
exports.requireEvidenceForDamage = requireEvidenceForDamage;
const db_js_1 = require("./db.js");
const exceptions_js_1 = require("./exceptions.js");
const transfer_evidence_js_1 = require("./transfer-evidence.js");
/** Pure: does this rule's scope (category/branch) apply, and does either independent threshold trigger? Same shape as ToleranceRule's ruleTriggers(). */
function ruleTriggers(rule, ctx) {
    const categoryMatches = rule.category === null || rule.category === ctx.category;
    const branchMatches = rule.branchId === null || rule.branchId === ctx.branchId;
    if (!categoryMatches || !branchMatches)
        return false;
    const quantityTriggers = rule.quantityThreshold !== null && ctx.quantity >= rule.quantityThreshold;
    const valueTriggers = rule.valueThreshold !== null && ctx.value >= rule.valueThreshold;
    return quantityTriggers || valueTriggers;
}
/** Picks the most specific matching, triggered rule: category+branch beats category-only or branch-only beats a global (both null) rule. */
function findTriggeredEvidenceRule(rules, ctx) {
    const specificity = (rule) => Number(rule.category !== null) + Number(rule.branchId !== null);
    const triggered = rules.filter((rule) => ruleTriggers(rule, ctx)).sort((a, b) => specificity(b) - specificity(a));
    return triggered[0] ?? null;
}
/**
 * Checks whether a damaged receipt line is gated by an active EvidenceRule
 * and, if so, whether evidence already exists for the transfer. Never
 * throws (a rule-engine failure must not block the underlying receipt from
 * at least attempting its normal path) - returns `{ blocked: false }` on
 * any internal error, same fail-open posture as checkApprovalGate /
 * getCountRecommendation elsewhere in this app.
 */
async function requireEvidenceForDamage(tenant, input) {
    try {
        const [item, rules, damagedValue] = await Promise.all([
            db_js_1.prisma.item.findFirst({ where: { id: input.itemId, companyId: tenant.companyId }, select: { category: true } }),
            db_js_1.prisma.evidenceRule.findMany({ where: { triggerType: input.triggerType, active: true, createdBy: { companyId: tenant.companyId } } }),
            (0, exceptions_js_1.estimateValueAtRisk)(tenant, input.itemId, input.damagedQty),
        ]);
        if (rules.length === 0)
            return { blocked: false };
        const ctx = { category: item?.category ?? null, branchId: input.branchId, quantity: input.damagedQty, value: damagedValue ?? 0 };
        const matched = findTriggeredEvidenceRule(rules, ctx);
        if (!matched)
            return { blocked: false };
        const existing = await (0, transfer_evidence_js_1.listTransferEvidence)(input.transferId);
        if (Array.isArray(existing) && existing.length > 0)
            return { blocked: false };
        return {
            blocked: true,
            matchedRuleId: matched.id,
            reason: `Attach at least one evidence photo before receiving - ${input.damagedQty} damaged unit(s) exceeds the "${matched.label}" threshold.`,
        };
    }
    catch (error) {
        console.error('requireEvidenceForDamage failed (fail-open, non-blocking):', error instanceof Error ? error.message : error);
        return { blocked: false };
    }
}
