export type ReorderRuleRecord = {
    id: string;
    itemId: string;
    locationId: string;
    minQty: number;
    targetQty: number;
    createdAt: string;
};
export declare function resetReorderStore(): void;
export declare function listReorderRules(locationId: string): ReorderRuleRecord[];
export declare function upsertReorderRule(input: {
    itemId: string;
    locationId: string;
    minQty: number;
    targetQty: number;
}): ReorderRuleRecord;
export declare function buildReplenishmentIntelligence(locationId: string): {
    generatedAt: string;
    executiveSummary: string;
    recommendations: {
        itemId: string;
        itemName: string;
        available: number;
        minQty: number;
        targetQty: number;
        suggestedOrderQty: number;
        suggestedAction: "NONE" | "PURCHASE" | "TRANSFER";
        sourceLocationId: string;
        sourceLocationName: string;
        suggestedTransferQty: number;
        actionReason: string;
        risk: string;
        confidence: string;
    }[];
    anomalies: {
        itemId: string;
        itemName: string;
        countId: string;
        bookQty: number;
        physicalQty: number;
        variance: number;
        countDate: string;
    }[];
    lotBlocks: any[];
    expiryActions: any[];
    overstock: any[];
};
