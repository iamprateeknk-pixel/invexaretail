import { createHash } from 'node:crypto';
import { DEFAULT_COMPANY_ID } from './saas/tenant-scope.js';

// Week 15: helpers for the signed marketplace webhook (POST
// /api/v1/webhooks/marketplaces/:connectorId). Kept pure so the tenant rule and
// the audit fingerprint are testable without booting the whole app.

/** Stable fingerprint of a delivered payload: what was received, never the payload itself. */
export function payloadChecksum(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Does a catalog row (item / location) belong to the connector's company?
 * An ingest must never resolve a SKU or a fulfilment location that another
 * company owns. A row whose owner is not tracked (legacy single-tenant data)
 * is only usable by the default company - it fails closed for everyone else.
 */
export function ownedByConnectorCompany(owner: string | undefined, connectorCompanyId: string): boolean {
  if (owner) return owner === connectorCompanyId;
  return connectorCompanyId === DEFAULT_COMPANY_ID;
}

export type ChannelEventAudit = {
  connectorId: string;
  provider: string;
  externalReference: string;
  payloadChecksum: string;
  receivedAt: string;
  outcome: 'CREATED' | 'DUPLICATE' | 'REJECTED_SIGNATURE' | 'REJECTED_INVALID' | 'REJECTED_NO_SKU_MATCH' | 'FAILED';
  orderId?: string;
};
