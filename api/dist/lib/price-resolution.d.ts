export type PriceCandidate = {
    id: string;
    price: number;
    branchId: string | null;
    customerGroup: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
};
export type PriceResolutionContext = {
    branchId?: string | null;
    customerGroup?: string | null;
    at?: string;
};
export declare function resolvePrice(candidates: PriceCandidate[], context?: PriceResolutionContext): PriceCandidate | null;
