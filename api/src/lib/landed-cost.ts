// Blueprint P7 "Landed cost: allocate freight, insurance, customs, handling
// by value/weight/qty/manual split" and "Margin truth: selling price -
// landed/valuation cost." This module only decides how to split a PO's
// extra charges across its lines - deterministic, no ML, and it never
// touches the stock ledger itself; the caller applies the result to the
// receiving lot's cost attributes.

export type LandedCostMethod = 'VALUE' | 'WEIGHT' | 'QUANTITY';

export type LandedCostLine = {
  itemId: string;
  quantity: number;
  unitCost: number;
  weightKg?: number | null;
};

export type LandedCostCharges = {
  freight?: number;
  customs?: number;
  insurance?: number;
  handling?: number;
};

export type LandedCostResult = {
  itemId: string;
  quantity: number;
  baseUnitCost: number;
  allocatedCharge: number;
  landedUnitCost: number;
};

function basisFor(line: LandedCostLine, method: LandedCostMethod): number {
  if (method === 'QUANTITY') return line.quantity;
  if (method === 'WEIGHT' && typeof line.weightKg === 'number' && line.weightKg > 0) return line.weightKg * line.quantity;
  // VALUE, or WEIGHT falling back to value when a line has no weight - a
  // missing weight should not zero out that line's share of the charges.
  return line.quantity * line.unitCost;
}

export function allocateLandedCost(
  lines: LandedCostLine[],
  charges: LandedCostCharges,
  method: LandedCostMethod = 'VALUE',
): LandedCostResult[] {
  const totalCharge = (charges.freight ?? 0) + (charges.customs ?? 0) + (charges.insurance ?? 0) + (charges.handling ?? 0);
  const basisByLine = lines.map((line) => basisFor(line, method));
  const totalBasis = basisByLine.reduce((sum, value) => sum + value, 0);

  return lines.map((line, index) => {
    const share = totalBasis > 0 ? basisByLine[index] / totalBasis : (lines.length ? 1 / lines.length : 0);
    const allocatedCharge = totalCharge * share;
    const landedUnitCost = line.quantity > 0 ? line.unitCost + allocatedCharge / line.quantity : line.unitCost;
    return {
      itemId: line.itemId,
      quantity: line.quantity,
      baseUnitCost: line.unitCost,
      allocatedCharge,
      landedUnitCost,
    };
  });
}
