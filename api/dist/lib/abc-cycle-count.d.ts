import type { CountAssignmentRecord, ItemRecord, StockLedgerRecord } from './repository.js';
import type { CountPriority } from './count-lifecycle.js';
export declare const ABC_CLASSES: readonly ["A", "B", "C"];
export type AbcClass = (typeof ABC_CLASSES)[number];
export type AbcValueSource = 'purchase' | 'qty_proxy' | 'mixed';
export declare const ABC_THRESHOLDS: {
    readonly A: 0.8;
    readonly B: 0.95;
};
export declare const ABC_CADENCE: Record<AbcClass, {
    abcClass: AbcClass;
    dueInDays: number;
    priority: CountPriority;
    label: string;
}>;
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
    summary: Record<AbcClass, {
        count: number;
        eligible: number;
        assigned: number;
        onHand: number;
        value: number;
        dueInDays: number;
        priority: CountPriority;
    }>;
    items: CycleCountPlanItem[];
};
export declare function parseAbcClasses(value: unknown): AbcClass[];
export declare function addDaysIso(now: Date, days: number): string;
export declare function classifyAbcClass(cumulativeBefore: number): AbcClass;
export declare function classifyAbcItems(rows: Array<{
    itemId: string;
    extendedValue: number;
}>): Map<string, {
    abcClass: AbcClass;
    share: number;
    cumulativeShare: number;
}>;
export declare function aggregateLocationStock(items: ItemRecord[], stock: StockLedgerRecord[]): CycleCountStockInput[];
export declare function buildCycleCountPlan(input: {
    locationId: string;
    items: ItemRecord[];
    stock: StockLedgerRecord[];
    assignments: CountAssignmentRecord[];
    now?: Date;
}): CycleCountPlan;
export declare function selectEligibleCycleCountItems(items: CycleCountPlanItem[], options: {
    classes?: AbcClass[];
    itemIds?: string[];
}): CycleCountPlanItem[];
export declare function cycleCountInstructions(abcClass: AbcClass): string;
