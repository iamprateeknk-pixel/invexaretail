/** Stable fingerprint of a delivered payload: what was received, never the payload itself. */
export declare function payloadChecksum(raw: string): string;
/**
 * Does a catalog row (item / location) belong to the connector's company?
 * An ingest must never resolve a SKU or a fulfilment location that another
 * company owns. A row whose owner is not tracked (legacy single-tenant data)
 * is only usable by the default company - it fails closed for everyone else.
 */
export declare function ownedByConnectorCompany(owner: string | undefined, connectorCompanyId: string): boolean;
export type ChannelEventAudit = {
    connectorId: string;
    provider: string;
    externalReference: string;
    payloadChecksum: string;
    receivedAt: string;
    outcome: 'CREATED' | 'DUPLICATE' | 'REJECTED_SIGNATURE' | 'REJECTED_INVALID' | 'REJECTED_NO_SKU_MATCH' | 'FAILED';
    orderId?: string;
};
/**
 * `Order.createdById` is a real foreign key to `User`, so a webhook cannot use
 * a made-up actor like the literal string 'connector' (it failed with an FK
 * violation on every delivery against a real database). Each company gets one
 * least-privilege, non-loginable service user that owns connector-created rows.
 */
export declare function connectorActorId(companyId: string): string;
export declare function ensureConnectorActor(db: {
    user: {
        upsert: (args: never) => Promise<unknown>;
    };
}, companyId: string): Promise<string>;
