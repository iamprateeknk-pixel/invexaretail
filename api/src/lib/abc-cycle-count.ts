import { estimateLotValue } from './expiry-board.js';
import type { CountAssignmentRecord, ItemRecord, StockLedgerRecord } from './repository.js';
import type { CountPriority } from './count-lifecycle.js';

export const ABC_CLASSES = ['A', 'B', 'C'] as const;
export type AbcClass = (typeof ABC_CLASSES)[number];
export type AbcValueSource = 'purchase' | 'qty_proxy' | 'mixed';

export const ABC_THRESHOLDS = { A: 0.8, B: 0.95 } as const;

export const ABC_CADENCE: Record<AbcClass, { abcClass: AbcClass; dueInDays: number; priority: CountPriority; label: string }> = {
  A: { abcClass: 'A', dueInDays: 7, priority: 'HIGH', label: 'Weekly' },
  B: { abcClass: 'B', dueInDays: 30, priority: 'NORMAL', label: 'Monthly' },
  C: { abcClass: 'C', dueInDays: 90, priority: 'LOW', label: 'Quarterly' },
};

export type CycleCountStockInput = {
  itemId: string;
  code: string;
  name: string;
  onHand: number;
  extendedValue: number;
  valueSource: AbcValueSource;
};

export type CycleCountPlanItem = CycleCountStockInput & {
  abcClass: AbcClass;
  share: number;
  cumulativeShare: number;
  dueInDays: number;
  priority: CountPriority;
  dueDate: string;
  assigned: boolean;
  /** When this item was last counted at this location (ISO), or null if never. */
  lastCountedAt: string | null;
  /** Whole days since the last count; null if never counted. */
  daysSinceCounted: number | null;
  /** Never counted, or last counted at least one cadence ago. */
  due: boolean;
  eligible: boolean;
};

export type CycleCountPlan = {
  locationId: string;
  generatedAt: string;
  totalValue: number;
  summary: Record<AbcClass, { count: number; eligible: number; assigned: number; onHand: number; value: number; dueInDays: number; priority: CountPriority }>;
  items: CycleCountPlanItem[];
};

function isAbcClass(value: string): value is AbcClass {
  return (ABC_CLASSES as readonly string[]).includes(value);
}

export function parseAbcClasses(value: unknown): AbcClass[] {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    return ['A'];
  }
  if (!Array.isArray(value)) {
    throw new Error('classes must be an array of A, B, or C.');
  }
  const selected = new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().toUpperCase())
      .filter(isAbcClass),
  );
  const classes = ABC_CLASSES.filter((abcClass) => selected.has(abcClass));
  if (classes.length === 0) {
    throw new Error('classes must include A, B, or C.');
  }
  return classes;
}

export function addDaysIso(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export function classifyAbcClass(cumulativeBefore: number): AbcClass {
  if (cumulativeBefore < ABC_THRESHOLDS.A) return 'A';
  if (cumulativeBefore < ABC_THRESHOLDS.B) return 'B';
  return 'C';
}

export function classifyAbcItems(rows: Array<{ itemId: string; extendedValue: number; valueSource?: AbcValueSource }>): Map<string, { abcClass: AbcClass; share: number; cumulativeShare: number }> {
  const anyCosted = rows.some((row) => row.valueSource === 'purchase' || row.valueSource === 'mixed');
  // With costs available, an item that has none cannot be ranked by value: it is held in B.
  const unvalued = anyCosted ? rows.filter((row) => row.valueSource === 'qty_proxy') : [];
  const unvaluedIds = new Set(unvalued.map((row) => row.itemId));
  const ranked = rows.filter((row) => !unvaluedIds.has(row.itemId)).sort((left, right) => {
    if (right.extendedValue !== left.extendedValue) return right.extendedValue - left.extendedValue;
    return left.itemId.localeCompare(right.itemId);
  });
  const totalValue = ranked.reduce((sum, row) => sum + row.extendedValue, 0);
  const classified = new Map<string, { abcClass: AbcClass; share: number; cumulativeShare: number }>();
  let cumulative = 0;
  for (const row of ranked) {
    const abcClass = totalValue <= 0 ? 'C' : classifyAbcClass(cumulative / totalValue);
    cumulative += row.extendedValue;
    classified.set(row.itemId, {
      abcClass,
      share: totalValue <= 0 ? 0 : row.extendedValue / totalValue,
      cumulativeShare: totalValue <= 0 ? 0 : cumulative / totalValue,
    });
  }
  for (const row of unvalued) classified.set(row.itemId, { abcClass: 'B', share: 0, cumulativeShare: 0 });
  return classified;
}

/**
 * Value of each item's stock at this location, for ABC ranking.
 *
 * Audit P1-5: a lot with no recorded cost used to contribute its UNIT COUNT as if it
 * were rupees, so 10,000 cheap units without a cost outranked a costed item worth
 * far more, and the ranking mixed two incompatible units. Now, whenever ANY stock
 * here has a cost, value is currency only: uncosted stock contributes 0 to the
 * ranking (flagged `qty_proxy`) and `classifyAbcItems` places such items in class B
 * - unknown value is neither top priority nor ignorable. Only when nothing has a cost
 * is quantity used, uniformly, as the ranking unit.
 */
export function aggregateLocationStock(items: ItemRecord[], stock: StockLedgerRecord[]): CycleCountStockInput[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  type Row = { itemId: string; lotId: string; onHand: number; costed: number | null };
  const rows: Row[] = [];
  for (const row of stock) {
    if (row.onHand <= 0) continue;
    const item = itemMap.get(row.itemId);
    if (!item) continue;
    const lot = item.lots.find((candidate) => candidate.id === row.lotId);
    rows.push({ itemId: row.itemId, lotId: row.lotId, onHand: row.onHand, costed: estimateLotValue(lot?.attributes, row.onHand) });
  }
  const anyCosted = rows.some((row) => row.costed !== null);

  const byItem = new Map<string, { onHand: number; extendedValue: number; sources: Set<Exclude<AbcValueSource, 'mixed'>> }>();
  for (const row of rows) {
    const source: Exclude<AbcValueSource, 'mixed'> = row.costed === null ? 'qty_proxy' : 'purchase';
    const value = row.costed ?? (anyCosted ? 0 : row.onHand);
    const current = byItem.get(row.itemId) ?? { onHand: 0, extendedValue: 0, sources: new Set() };
    current.onHand += row.onHand;
    current.extendedValue += value;
    current.sources.add(source);
    byItem.set(row.itemId, current);
  }

  return [...byItem.entries()]
    .map(([itemId, totals]) => {
      const item = itemMap.get(itemId)!;
      const valueSource: AbcValueSource = totals.sources.size > 1 ? 'mixed' : [...totals.sources][0] ?? 'qty_proxy';
      return {
        itemId,
        code: item.code,
        name: item.name,
        onHand: totals.onHand,
        extendedValue: totals.extendedValue,
        valueSource,
      };
    })
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}

export function buildCycleCountPlan(input: {
  locationId: string;
  items: ItemRecord[];
  stock: StockLedgerRecord[];
  assignments: CountAssignmentRecord[];
  /** Past counts, used to honour the cadence (an A item counted yesterday is not due again). */
  counts?: Array<{ itemId: string; locationId: string; createdAt: string }>;
  now?: Date;
}): CycleCountPlan {
  const now = input.now ?? new Date();
  const locationStock = input.stock.filter((row) => row.locationId === input.locationId);
  const aggregated = aggregateLocationStock(input.items, locationStock);
  const classified = classifyAbcItems(aggregated);
  const assignedItemIds = new Set(
    input.assignments
      .filter((assignment) => assignment.locationId === input.locationId && assignment.status === 'ASSIGNED')
      .map((assignment) => assignment.itemId),
  );

  const lastCounted = new Map<string, string>();
  for (const count of input.counts ?? []) {
    if (count.locationId !== input.locationId) continue;
    const previous = lastCounted.get(count.itemId);
    if (!previous || count.createdAt > previous) lastCounted.set(count.itemId, count.createdAt);
  }

  const planItems: CycleCountPlanItem[] = aggregated
    .map((row) => {
      const abc = classified.get(row.itemId)!;
      const cadence = ABC_CADENCE[abc.abcClass];
      const assigned = assignedItemIds.has(row.itemId);
      // Audit P1-6: eligibility used to be just "not currently assigned", so every A item
      // was eligible every day regardless of when it was last counted - the weekly/monthly/
      // quarterly cadence only set a due date on the assignment, it never gated one.
      const last = lastCounted.get(row.itemId) ?? null;
      const daysSince = last ? Math.floor((now.getTime() - Date.parse(last)) / 86_400_000) : null;
      const due = daysSince === null || daysSince >= cadence.dueInDays;
      return {
        ...row,
        abcClass: abc.abcClass,
        share: abc.share,
        cumulativeShare: abc.cumulativeShare,
        dueInDays: cadence.dueInDays,
        priority: cadence.priority,
        dueDate: addDaysIso(now, cadence.dueInDays),
        assigned,
        lastCountedAt: last,
        daysSinceCounted: daysSince,
        due,
        eligible: !assigned && due,
      };
    })
    .sort((left, right) => {
      if (right.extendedValue !== left.extendedValue) return right.extendedValue - left.extendedValue;
      return left.itemId.localeCompare(right.itemId);
    });

  const emptyClass = (abcClass: AbcClass) => ({
    count: 0,
    eligible: 0,
    assigned: 0,
    onHand: 0,
    value: 0,
    dueInDays: ABC_CADENCE[abcClass].dueInDays,
    priority: ABC_CADENCE[abcClass].priority,
  });

  const summary: CycleCountPlan['summary'] = {
    A: emptyClass('A'),
    B: emptyClass('B'),
    C: emptyClass('C'),
  };

  for (const item of planItems) {
    const bucket = summary[item.abcClass];
    bucket.count += 1;
    bucket.onHand += item.onHand;
    bucket.value += item.extendedValue;
    if (item.assigned) bucket.assigned += 1;
    if (item.eligible) bucket.eligible += 1;
  }

  return {
    locationId: input.locationId,
    generatedAt: now.toISOString(),
    totalValue: planItems.reduce((sum, item) => sum + item.extendedValue, 0),
    summary,
    items: planItems,
  };
}

export function selectEligibleCycleCountItems(
  items: CycleCountPlanItem[],
  options: { classes?: AbcClass[]; itemIds?: string[] },
): CycleCountPlanItem[] {
  const classSet = new Set(options.classes ?? ['A']);
  const idSet = options.itemIds && options.itemIds.length > 0 ? new Set(options.itemIds) : null;
  return items.filter((item) => item.eligible && classSet.has(item.abcClass) && (!idSet || idSet.has(item.itemId)));
}

export function cycleCountInstructions(abcClass: AbcClass): string {
  const cadence = ABC_CADENCE[abcClass];
  return `ABC cycle count · class ${abcClass} · ${cadence.label.toLowerCase()}`;
}
