export type NetworkStock = {
    locationId: string;
    locationName: string;
    locationType: string;
    available: number;
};
export type ReplenishmentRoute = {
    action: 'NONE' | 'TRANSFER' | 'PURCHASE';
    sourceLocationId?: string;
    sourceLocationName?: string;
    suggestedTransferQty: number;
    reason: string;
};
export declare function routeReplenishment(destinationLocationId: string, requiredQty: number, network: NetworkStock[]): ReplenishmentRoute;
