"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTROL_PLANE_STATE_ID = exports.CONTROL_PLANE_SNAPSHOT_VERSION = void 0;
exports.serializeControlPlane = serializeControlPlane;
exports.applyControlPlaneSnapshot = applyControlPlaneSnapshot;
exports.isControlPlaneSnapshot = isControlPlaneSnapshot;
exports.CONTROL_PLANE_SNAPSHOT_VERSION = 1;
exports.CONTROL_PLANE_STATE_ID = 'saas-v1';
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function serializeControlPlane(plane) {
    return {
        version: exports.CONTROL_PLANE_SNAPSHOT_VERSION,
        tenantId: plane.tenantId,
        plans: [...plane.plans.values()].map((plan) => clone(plan)),
        companies: [...plane.companies.values()].map((company) => clone(company)),
        platformUsers: [...plane.platformUsers.values()].map((user) => clone(user)),
        companyUsers: [...plane.companyUsers.values()].map((user) => clone(user)),
        sessions: [...plane.sessions.values()].map((session) => clone(session)),
        entitlements: [...plane.entitlements.entries()].map(([key, value]) => [key, clone(value)]),
        limitOverrides: [...plane.limitOverrides.entries()].map(([key, value]) => [key, clone(value)]),
        usage: [...plane.usage.entries()].map(([key, value]) => [key, clone(value)]),
        audit: clone(plane.audit.slice(-500)),
        safety: [...plane.safety.entries()],
        drafts: [...plane.drafts.values()].map((draft) => clone(draft)),
        published: [...plane.published.values()].map((published) => clone(published)),
        versions: [...plane.versions.entries()].map(([key, value]) => [key, clone(value)]),
        fieldValues: [...plane.fieldValues.entries()].map(([key, value]) => [key, clone(value)]),
        ledger: [...plane.ledger.entries()],
        mutations: [...plane.mutations.values()].map((mutation) => clone(mutation)),
        devices: [...plane.devices.entries()].map(([key, value]) => [key, clone(value)]),
        apiKeys: [...plane.apiKeys.entries()].map(([key, value]) => [key, clone(value)]),
        webhooks: [...plane.webhooks.entries()].map(([key, value]) => [key, clone(value)]),
        connectors: [...plane.connectors.entries()].map(([key, value]) => [key, clone(value)]),
        billing: [...plane.billing.entries()].map(([key, value]) => [key, clone(value)]),
        invoices: [...plane.invoices.values()].map((invoice) => clone(invoice)),
        outbox: clone(plane.outbox.slice(-200)),
    };
}
function applyControlPlaneSnapshot(plane, snapshot) {
    const seededPlans = new Map(plane.plans);
    plane.tenantId = snapshot.tenantId || plane.tenantId;
    plane.plans = new Map((snapshot.plans ?? []).map((plan) => [plan.id, clone(plan)]));
    for (const [id, plan] of seededPlans) {
        if (!plane.plans.has(id))
            plane.plans.set(id, plan);
    }
    plane.companies = new Map((snapshot.companies ?? []).map((company) => [company.id, clone(company)]));
    plane.platformUsers = new Map((snapshot.platformUsers ?? []).map((user) => [user.id, clone(user)]));
    plane.companyUsers = new Map((snapshot.companyUsers ?? []).map((user) => [user.id, clone(user)]));
    plane.sessions = new Map((snapshot.sessions ?? []).map((session) => [session.id, clone(session)]));
    plane.entitlements = new Map((snapshot.entitlements ?? []).map(([key, value]) => [key, clone(value)]));
    plane.limitOverrides = new Map((snapshot.limitOverrides ?? []).map(([key, value]) => [key, clone(value)]));
    plane.usage = new Map((snapshot.usage ?? []).map(([key, value]) => [key, clone(value)]));
    plane.audit = clone(snapshot.audit ?? []);
    plane.safety = new Map(snapshot.safety ?? []);
    plane.drafts = new Map((snapshot.drafts ?? []).map((draft) => [draft.companyId, clone(draft)]));
    plane.published = new Map((snapshot.published ?? []).map((published) => [published.companyId, clone(published)]));
    plane.versions = new Map((snapshot.versions ?? []).map(([key, value]) => [key, clone(value)]));
    plane.fieldValues = new Map((snapshot.fieldValues ?? []).map(([key, value]) => [key, clone(value)]));
    plane.ledger = new Map(snapshot.ledger ?? []);
    plane.mutations = new Map((snapshot.mutations ?? []).map((mutation) => [mutation.mutationId, clone(mutation)]));
    plane.devices = new Map((snapshot.devices ?? []).map(([key, value]) => [key, clone(value)]));
    plane.apiKeys = new Map((snapshot.apiKeys ?? []).map(([key, value]) => [key, clone(value)]));
    plane.webhooks = new Map((snapshot.webhooks ?? []).map(([key, value]) => [key, clone({
            name: 'Ops webhook',
            signingSecret: '',
            createdAt: new Date(0).toISOString(),
            ...value,
        })]));
    plane.connectors = new Map((snapshot.connectors ?? []).map(([key, value]) => [key, clone(value)]));
    plane.billing = new Map((snapshot.billing ?? []).map(([key, value]) => [key, clone(value)]));
    plane.invoices = new Map((snapshot.invoices ?? []).map((invoice) => [invoice.id, clone(invoice)]));
    plane.outbox = clone(snapshot.outbox ?? []);
}
function isControlPlaneSnapshot(value) {
    if (!value || typeof value !== 'object')
        return false;
    const snapshot = value;
    return snapshot.version === exports.CONTROL_PLANE_SNAPSHOT_VERSION && Array.isArray(snapshot.companies);
}
