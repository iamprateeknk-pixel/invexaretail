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
export declare function suggestReorderRule(input: {
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
}): ReorderSuggestion | null;
