// Computed reorder-rule suggestions (audit O-1). Reorder rules were hand-typed only; this derives
// a suggested min (reorder point) and target (order-up-to) from demand, lead time and a service
// level, so a human can accept or ignore it. Read-only: nothing here writes a rule.
import { classifyDemandPattern, computeDemandStats, computeSafetyStock, crostonDailyDemand } from './demand-forecast.js';

export type ReorderSuggestion = {
  itemId: string;
  demandPattern: string;
  averageDailyDemand: number;
  safetyStock: number;
  suggestedMin: number;
  suggestedTarget: number;
  currentMin: number | null;
  currentTarget: number | null;
  /** NEW: no rule yet. INCREASE/DECREASE: the current rule differs from the suggestion by more than the tolerance. OK otherwise. */
  change: 'NEW' | 'INCREASE' | 'DECREASE' | 'OK';
};

const CHANGE_TOLERANCE = 0.25;

export function suggestReorderRule(input: {
  itemId: string;
  /** Net daily demand for the window, zeros included. */
  dailyDemand: number[];
  leadTimeDays: number;
  leadTimeStdDevDays?: number;
  servicePercent?: number;
  /** Days of demand the target holds beyond the reorder point (the order cycle). */
  coverDays?: number;
  decimal?: boolean;
  currentMin?: number | null;
  currentTarget?: number | null;
}): ReorderSuggestion | null {
  const demand = input.dailyDemand.map((value) => Math.max(0, value));
  if (demand.every((value) => value === 0)) return null; // no demand history: nothing to derive a rule from
  const stats = computeDemandStats(demand);
  const { pattern } = classifyDemandPattern(demand);
  const average = pattern === 'INTERMITTENT' || pattern === 'LUMPY' ? crostonDailyDemand(demand) : stats.averageDailyDemand;
  const safetyStock = computeSafetyStock({
    averageDailyDemand: average,
    stdDevDailyDemand: stats.stdDevDailyDemand,
    averageLeadTimeDays: input.leadTimeDays,
    leadTimeStdDevDays: input.leadTimeStdDevDays,
    servicePercent: input.servicePercent,
  });
  const round = (value: number) => (input.decimal ? Math.round(value * 1000) / 1000 : Math.ceil(value));
  const suggestedMin = round(average * input.leadTimeDays + safetyStock);
  const suggestedTarget = Math.max(suggestedMin, round(suggestedMin + average * (input.coverDays ?? 7)));
  const currentMin = input.currentMin ?? null;
  const currentTarget = input.currentTarget ?? null;
  let change: ReorderSuggestion['change'] = 'NEW';
  if (currentMin !== null && currentTarget !== null) {
    const drift = (suggestedTarget - currentTarget) / Math.max(1, currentTarget);
    change = drift > CHANGE_TOLERANCE ? 'INCREASE' : drift < -CHANGE_TOLERANCE ? 'DECREASE' : 'OK';
  }
  return { itemId: input.itemId, demandPattern: pattern, averageDailyDemand: Math.round(average * 1000) / 1000, safetyStock: Math.round(safetyStock * 1000) / 1000, suggestedMin, suggestedTarget, currentMin, currentTarget, change };
}
