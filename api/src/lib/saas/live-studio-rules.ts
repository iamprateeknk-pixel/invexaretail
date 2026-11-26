import type { RuleDefinition } from './control-plane.js';

const suffixes = ['Gte', 'Lte', 'Gt', 'Lt'] as const;
const valueFields = { STOCK_ADJUSTMENT: 'adjustmentValue', TRANSFER_CONFIRM: 'transferValue' } as const;
export type LiveRuleTrigger = keyof typeof valueFields;

export function ruleConditionMatches(condition: Record<string, unknown>, context: Record<string, unknown>): boolean {
  return Object.entries(condition).every(([key, expected]) => {
    const comparator = suffixes.find((suffix) => key.endsWith(suffix));
    if (!comparator) return context[key] === expected;
    const raw = context[key.slice(0, -comparator.length)];
    if (raw == null || expected == null || raw === '' || expected === '') return false;
    const actual = Number(raw);
    const threshold = Number(expected);
    if (!Number.isFinite(actual) || !Number.isFinite(threshold)) return false;
    if (comparator === 'Gt') return actual > threshold;
    if (comparator === 'Gte') return actual >= threshold;
    if (comparator === 'Lt') return actual < threshold;
    return actual <= threshold;
  });
}

export function validateLiveStudioRule(rule: RuleDefinition): void {
  if (rule.liveFor === undefined) return;
  if (!Object.hasOwn(valueFields, rule.liveFor) || typeof rule.key !== 'string' || !rule.key.trim() ||
      typeof rule.name !== 'string' || !rule.name.trim()) throw new Error('Choose a supported live command and name the rule.');
  const conditions = Object.entries(rule.condition ?? {});
  const field = valueFields[rule.liveFor];
  const keys = new Set([field, ...suffixes.map((suffix) => `${field}${suffix}`)]);
  if (!conditions.length || conditions.some(([key, value]) => !keys.has(key) || typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`Live rules for this command require conditions on ${field} with numeric values.`);
  }
  const role = rule.outcome?.requireApproval;
  if (rule.outcome?.action !== 'BLOCK' && role !== 'ADMIN' && role !== 'BRANCH_MANAGER') {
    throw new Error('Live rules can stop the command or require a branch manager or admin to approve.');
  }
}

export function publishedLiveStudioRules(payload: unknown, triggerType: string): RuleDefinition[] {
  if (!payload || typeof payload !== 'object' || !('rules' in payload) || !Array.isArray(payload.rules)) return [];
  const rules = payload.rules.filter((rule): rule is RuleDefinition => !!rule && rule.liveFor === triggerType);
  rules.forEach(validateLiveStudioRule);
  return rules;
}

export function matchingLiveStudioRules(rules: RuleDefinition[], triggerType: string, value: number): RuleDefinition[] {
  if (!Object.hasOwn(valueFields, triggerType)) return [];
  return rules.filter((rule) => ruleConditionMatches(rule.condition, { [valueFields[triggerType as LiveRuleTrigger]]: value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
