export type LocationCandidate = {
    locationId: string;
    locationName: string;
    locationType: string;
    latitude?: number | null;
    longitude?: number | null;
    deliverySlaHours?: number | null;
    shippingCostPerKm?: number | null;
    openOrderCount?: number | null;
};
export type RoutingContext = {
    customerLatitude?: number | null;
    customerLongitude?: number | null;
};
export declare const ROUTING_WEIGHTS: {
    readonly distance: 0.4;
    readonly sla: 0.2;
    readonly cost: 0.2;
    readonly workload: 0.15;
    readonly storePreference: 0.05;
};
export declare function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number;
export declare function isStoreLocation(type: string): boolean;
export declare function candidateRoutingScore(candidate: LocationCandidate, ctx?: RoutingContext): number;
export declare function rankOrderCandidates(candidates: LocationCandidate[], ctx?: RoutingContext): LocationCandidate[];
export type SplitLine = {
    itemId: string;
    quantity: number;
};
export type LocationAvailability = Map<string, Map<string, number>>;
export type SplitSlice = {
    locationId: string;
    lines: SplitLine[];
};
/**
 * Greedy multi-location split: walk ranked candidates and take whatever
 * each location can still promise, per item, until every line is covered
 * or leftover remainder is reported as backorder. Pure so OMS can decide
 * "split vs fail" without touching the database.
 */
export declare function splitLinesAcrossLocations(lines: SplitLine[], ranked: LocationCandidate[], availability: LocationAvailability): {
    splits: SplitSlice[];
    remainder: SplitLine[];
};
