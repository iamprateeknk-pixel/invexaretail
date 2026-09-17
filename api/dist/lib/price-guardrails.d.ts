export type PriceGuardrailSeverity = 'BLOCK' | 'WARN';
export type PriceGuardrailViolation = {
    code: 'ABOVE_MRP' | 'BELOW_COST' | 'BELOW_MIN_MARGIN' | 'INVALID_EFFECTIVE_DATE';
    severity: PriceGuardrailSeverity;
    message: string;
};
export type PriceGuardrailInput = {
    proposedPrice: number;
    mrp?: number | null;
    landedCost?: number | null;
    minMarginPercent?: number | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
};
export type PriceGuardrailResult = {
    ok: boolean;
    marginPercent: number | null;
    violations: PriceGuardrailViolation[];
};
export declare function validatePrice(input: PriceGuardrailInput): PriceGuardrailResult;
