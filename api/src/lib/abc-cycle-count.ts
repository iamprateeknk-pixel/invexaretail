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

export function classifyAbcItems(rows: Array<{ itemId: string; extendedValue: number }>): Map<string, { abcClass: AbcClass; share: number; cumulativeShare: number }> {
  const ranked = [...rows].sort((left, right) => {
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
  return classified;
}

export function aggregateLocationStock(items: ItemRecord[], stock: StockLedgerRecord[]): CycleCountStockInput[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const byItem = new Map<string, { onHand: number; extendedValue: number; sources: Set<Exclude<AbcValueSource, 'mixed'>> }>();

  for (const row of stock) {
    if (row.onHand <= 0) continue;
    const item = itemMap.get(row.itemId);
    if (!item) continue;
    const lot = item.lots.find((candidate) => candidate.id === row.lotId);
    const purchaseValue = estimateLotValue(lot?.attributes, row.onHand);
    const source: Exclude<AbcValueSource, 'mixed'> = purchaseValue === null ? 'qty_proxy' : 'purchase';
    const current = byItem.get(row.itemId) ?? { onHand: 0, extendedValue: 0, sources: new Set() };
    current.onHand += row.onHand;
    current.extendedValue += purchaseValue ?? row.onHand;
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

  const planItems: CycleCountPlanItem[] = aggregated
    .map((row) => {
      const abc = classified.get(row.itemId)!;
      const cadence = ABC_CADENCE[abc.abcClass];
      const assigned = assignedItemIds.has(row.itemId);
      return {
        ...row,
        abcClass: abc.abcClass,
        share: abc.share,
        cumulativeShare: abc.cumulativeShare,
        dueInDays: cadence.dueInDays,
        priority: cadence.priority,
        dueDate: addDaysIso(now, cadence.dueInDays),
        assigned,
        eligible: !assigned,
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
