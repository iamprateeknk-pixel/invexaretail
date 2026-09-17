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
export declare function allocateLandedCost(lines: LandedCostLine[], charges: LandedCostCharges, method?: LandedCostMethod): LandedCostResult[];
