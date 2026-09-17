"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCompanyIdFromEvent = resolveCompanyIdFromEvent;
exports.listControlPlaneWebhookTargets = listControlPlaneWebhookTargets;
const control_plane_js_1 = require("./saas/control-plane.js");
const tenant_scope_js_1 = require("./saas/tenant-scope.js");
const LOCATION_KEYS = ['locationId', 'sourceLocationId', 'destinationLocationId', 'fromLocationId', 'toLocationId'];
const ITEM_KEYS = ['itemId'];
function resolveCompanyIdFromEvent(data = {}) {
    for (const key of LOCATION_KEYS) {
        const value = data[key];
        if (typeof value === 'string' && value) {
            const owner = (0, tenant_scope_js_1.ownerOfLocation)(value);
            if (owner)
                return owner;
        }
    }
    for (const key of ITEM_KEYS) {
        const value = data[key];
        if (typeof value === 'string' && value) {
            const owner = (0, tenant_scope_js_1.ownerOfItem)(value);
            if (owner)
                return owner;
        }
    }
    if (typeof data.companyId === 'string' && data.companyId)
        return data.companyId;
    return undefined;
}
function listControlPlaneWebhookTargets(companyId, eventType) {
    const scoped = companyId || tenant_scope_js_1.DEFAULT_COMPANY_ID;
    return [...control_plane_js_1.controlPlane.webhooks.values()]
        .filter((hook) => hook.companyId === scoped && hook.status === 'active' && hook.events.includes(eventType))
        .map((hook) => ({
        id: hook.id,
        name: hook.name,
        url: hook.url,
        signingSecret: hook.signingSecret,
        createdAt: hook.createdAt,
    }));
}
