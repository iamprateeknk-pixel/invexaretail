"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const access_control_js_1 = require("../lib/access-control.js");
const inventory_js_1 = require("../lib/inventory.js");
const repository_js_1 = require("../lib/repository.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const transfer_evidence_js_1 = require("../lib/transfer-evidence.js");
const signed_access_js_1 = require("../lib/signed-access.js");
// Guide Week 18: evidence is fetched through short-lived signed links, so a
// photo can be shown in an <img>, a PDF or a support ticket without handing
// out the caller's bearer token, and a link cannot be replayed for another
// resource, another company, or after it expires.
const router = (0, express_1.Router)();
const KIND = 'transfer-evidence';
const INVENTORY_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
function accessContext(user) {
    const role = INVENTORY_ROLES.includes(user.role) ? user.role : 'STORE_USER';
    return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}
const first = (value) => (Array.isArray(value) ? value[0] : value ?? '');
router.post('/transfers/:transferId/evidence/:evidenceId/access-link', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, access_control_js_1.enforcePermissionOverrides, async (req, res) => {
    const transferId = first(req.params.transferId);
    const evidenceId = first(req.params.evidenceId);
    const transfer = (0, repository_js_1.listTransfers)().find((record) => record.id === transferId);
    if (!transfer)
        return res.status(404).json({ message: 'Transfer was not found.' });
    const context = accessContext(req.user);
    if (!(0, inventory_js_1.canAccessLocation)(context, transfer.sourceLocationId) && !(0, inventory_js_1.canAccessLocation)(context, transfer.destinationLocationId)) {
        return res.status(403).json({ message: 'Transfer location access denied.' });
    }
    try {
        const evidence = (await (0, transfer_evidence_js_1.listTransferEvidence)(transferId)).find((row) => row.id === evidenceId);
        if (!evidence)
            return res.status(404).json({ message: 'Photo was not found.' });
    }
    catch {
        return res.status(503).json({ message: 'Evidence storage unavailable.' });
    }
    const ttl = Number(req.body?.ttlSeconds);
    const { token, expiresAt } = (0, signed_access_js_1.createSignedAccessToken)({
        kind: KIND, resource: `${transferId}/${evidenceId}`, companyId: req.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
        ttlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
    });
    return res.status(201).json({ url: `/api/v1/evidence-files/${token}`, expiresAt });
});
// Deliberately unauthenticated by bearer token: the signed, expiring,
// company-bound link is the credential (same model as the marketplace webhook).
router.get('/evidence-files/:token', async (req, res) => {
    const claims = (0, signed_access_js_1.verifySignedAccessToken)(first(req.params.token));
    if (!claims || claims.kind !== KIND)
        return res.status(404).json({ message: 'Link is invalid or has expired.' });
    const [transferId, evidenceId] = claims.resource.split('/');
    const transfer = (0, repository_js_1.listTransfers)().find((record) => record.id === transferId);
    // The link's company must still own the transfer it was issued for.
    const owner = transfer ? (0, tenant_scope_js_1.ownerOfLocation)(transfer.sourceLocationId) ?? (0, tenant_scope_js_1.ownerOfLocation)(transfer.destinationLocationId) : undefined;
    if (!transfer || (owner ?? tenant_scope_js_1.DEFAULT_COMPANY_ID) !== claims.companyId)
        return res.status(404).json({ message: 'Link is invalid or has expired.' });
    try {
        const evidence = await (0, transfer_evidence_js_1.readTransferEvidence)(transferId, evidenceId);
        if (!evidence)
            return res.status(404).json({ message: 'Link is invalid or has expired.' });
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'attachment');
        return res.type(evidence.mimeType).send(Buffer.from(evidence.contents));
    }
    catch {
        return res.status(503).json({ message: 'Evidence storage unavailable.' });
    }
});
exports.default = router;
