export type ConnectorPlatform = 'AMAZON' | 'FLIPKART' | 'WEBSITE' | 'CUSTOM';
export type NormalizedConnectorOrder = {
    channel: string;
    externalReference: string;
    customerName: string | null;
    notes: string | null;
    lines: Array<{
        sku: string;
        quantity: number;
    }>;
};
export type ConnectorRecord = {
    id: string;
    name: string;
    platform: ConnectorPlatform;
    channel: string;
    webhookSecret: string;
    status: 'ACTIVE' | 'PAUSED';
    tenantId: string;
    createdAt: string;
    lastIngestedAt: string | null;
};
export declare function mapMarketplaceOrder(platform: ConnectorPlatform, payload: Record<string, unknown>): NormalizedConnectorOrder;
export declare function validateNormalizedOrder(order: NormalizedConnectorOrder): string | null;
export declare function resetConnectors(): void;
export declare function listConnectors(tenantId?: string): ConnectorRecord[];
export declare function createConnector(input: {
    name: string;
    platform: ConnectorPlatform;
    channel?: string;
    webhookSecret: string;
    tenantId: string;
}): ConnectorRecord;
export declare function findConnector(id: string): ConnectorRecord | undefined;
export declare function markConnectorIngested(id: string): void;
export declare function verifyConnectorSignature(secret: string, payload: string, signature: string | undefined): boolean;
