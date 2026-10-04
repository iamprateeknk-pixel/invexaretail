"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payloadChecksum = payloadChecksum;
exports.ownedByConnectorCompany = ownedByConnectorCompany;
exports.connectorActorId = connectorActorId;
exports.ensureConnectorActor = ensureConnectorActor;
const node_crypto_1 = require("node:crypto");
const tenant_scope_js_1 = require("./saas/tenant-scope.js");
// Week 15: helpers for the signed marketplace webhook (POST
// /api/v1/webhooks/marketplaces/:connectorId). Kept pure so the tenant rule and
// the audit fingerprint are testable without booting the whole app.
/** Stable fingerprint of a delivered payload: what was received, never the payload itself. */
function payloadChecksum(raw) {
    return (0, node_crypto_1.createHash)('sha256').update(raw).digest('hex');
}
/**
 * Does a catalog row (item / location) belong to the connector's company?
 * An ingest must never resolve a SKU or a fulfilment location that another
 * company owns. A row whose owner is not tracked (legacy single-tenant data)
 * is only usable by the default company - it fails closed for everyone else.
 */
function ownedByConnectorCompany(owner, connectorCompanyId) {
    if (owner)
        return owner === connectorCompanyId;
    return connectorCompanyId === tenant_scope_js_1.DEFAULT_COMPANY_ID;
}
/**
 * `Order.createdById` is a real foreign key to `User`, so a webhook cannot use
 * a made-up actor like the literal string 'connector' (it failed with an FK
 * violation on every delivery against a real database). Each company gets one
 * least-privilege, non-loginable service user that owns connector-created rows.
 */
function connectorActorId(companyId) {
    return `connector-${companyId}`;
}
async function ensureConnectorActor(db, companyId) {
    const id = connectorActorId(companyId);
    await db.user.upsert({
        where: { id },
        update: {},
        create: {
            id,
            name: 'Marketplace connector',
            email: `${id}@system.invexa.local`,
            // Not a valid bcrypt hash and the account is INACTIVE: it can never authenticate.
            passwordHash: '!disabled-service-account',
            role: 'AUDITOR',
            status: 'INACTIVE',
            assignedLocations: '[]',
            companyId,
        },
    });
    return id;
}
