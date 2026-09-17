// Blueprint P9 "Retail pricing: guardrails - block/warn below landed cost,
// below minimum margin, above MRP, invalid effective date." Deterministic
// validation only - this module decides whether a proposed price is legal
// to publish, it never touches the ledger or ordering, and every violation
// names exactly which rule it broke.

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

export function validatePrice(input: PriceGuardrailInput): PriceGuardrailResult {
  const violations: PriceGuardrailViolation[] = [];

  if (typeof input.mrp === 'number' && input.proposedPrice > input.mrp) {
    violations.push({
      code: 'ABOVE_MRP', severity: 'BLOCK',
      message: `Price ${input.proposedPrice} exceeds MRP ${input.mrp}.`,
    });
  }

  if (typeof input.landedCost === 'number' && input.proposedPrice < input.landedCost) {
    violations.push({
      code: 'BELOW_COST', severity: 'BLOCK',
      message: `Price ${input.proposedPrice} is below landed cost ${input.landedCost} - this would sell at a loss.`,
    });
  }

  let marginPercent: number | null = null;
  if (typeof input.landedCost === 'number' && input.proposedPrice > 0) {
    marginPercent = ((input.proposedPrice - input.landedCost) / input.proposedPrice) * 100;
    if (typeof input.minMarginPercent === 'number' && marginPercent < input.minMarginPercent) {
      violations.push({
        code: 'BELOW_MIN_MARGIN', severity: 'WARN',
        message: `Margin ${marginPercent.toFixed(1)}% is below the minimum ${input.minMarginPercent}%.`,
      });
    }
  }

  if (input.effectiveFrom && input.effectiveTo) {
    if (new Date(input.effectiveTo).getTime() <= new Date(input.effectiveFrom).getTime()) {
      violations.push({
        code: 'INVALID_EFFECTIVE_DATE', severity: 'BLOCK',
        message: 'Effective end date must be after the effective start date.',
      });
    }
  }

  return {
    ok: !violations.some((violation) => violation.severity === 'BLOCK'),
    marginPercent,
    violations,
  };
}
