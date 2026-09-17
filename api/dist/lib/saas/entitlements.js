"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NAV_ENTITLEMENTS = exports.ENTITLEMENT_FEATURES = void 0;
exports.featureForEntitlementPath = featureForEntitlementPath;
exports.isPlanEntitled = isPlanEntitled;
exports.hiddenNavigationForModules = hiddenNavigationForModules;
exports.planModulesForCompany = planModulesForCompany;
exports.hiddenNavigationForCompany = hiddenNavigationForCompany;
exports.enforcePlanEntitlements = enforcePlanEntitlements;
const control_plane_js_1 = require("./control-plane.js");
exports.ENTITLEMENT_FEATURES = [
    'OMS',
    'ANALYTICS',
    'INTEGRATIONS',
    'PURCHASING',
    'ADVANCED_WORKFLOW',
    'WMS',
    'INVENTORY',
];
const FEATURE_SEGMENTS = {
    OMS: new Set(['orders', 'fulfillments', 'checkout']),
    ANALYTICS: new Set(['intelligence', 'analytics']),
    INTEGRATIONS: new Set(['webhook-subscriptions', 'webhook-deliveries']),
    PURCHASING: new Set(['purchase-orders', 'suppliers', 'reorder-rules']),
    ADVANCED_WORKFLOW: new Set(['approval-rules', 'tolerance-rules', 'evidence-rules']),
    WMS: new Set(['transfers', 'waves', 'picks', 'putaway', 'receiving', 'picker', 'picker-tasks', 'pick-waves', 'putaway-tasks', 'bins']),
    INVENTORY: new Set(['stock', 'items', 'counts', 'imports', 'locations', 'opening-stock', 'stock-adjustments', 'stock-takes', 'cycle-counts']),
};
exports.NAV_ENTITLEMENTS = {
    orders: 'OMS',
    intelligence: 'ANALYTICS',
    integrations: 'INTEGRATIONS',
    'purchase-orders': 'PURCHASING',
    transfers: 'WMS',
    picking: 'WMS',
    putaway: 'WMS',
    inventory: 'INVENTORY',
    counts: 'INVENTORY',
    expiry: 'INVENTORY',
    'stock-update': 'INVENTORY',
    catalog: 'INVENTORY',
};
function isAuthRoute(req) {
    return /\/auth\//.test(`${req.originalUrl ?? ''} ${req.path ?? ''}`);
}
function featureForEntitlementPath(path) {
    const segments = String(path ?? '').split('/').filter(Boolean);
    for (const feature of exports.ENTITLEMENT_FEATURES) {
        if (segments.some((segment) => FEATURE_SEGMENTS[feature].has(segment))) {
            return feature;
        }
    }
    return null;
}
function isPlanEntitled(companyId, featureKey) {
    const company = control_plane_js_1.controlPlane.companies.get(companyId);
    if (!company)
        return false;
    const plan = control_plane_js_1.controlPlane.plans.get(company.planId);
    const fromPlan = plan?.modules[featureKey] ?? plan?.capabilities[featureKey] ?? false;
    const companyValue = control_plane_js_1.controlPlane.entitlements.get(companyId)?.[featureKey];
    return companyValue ?? fromPlan;
}
function hiddenNavigationForModules(modules) {
    return Object.entries(exports.NAV_ENTITLEMENTS)
        .filter(([, feature]) => modules[feature] === false)
        .map(([id]) => id);
}
function planModulesForCompany(companyId) {
    return Object.fromEntries(exports.ENTITLEMENT_FEATURES.map((feature) => [feature, isPlanEntitled(companyId, feature)]));
}
function hiddenNavigationForCompany(companyId) {
    return hiddenNavigationForModules(planModulesForCompany(companyId));
}
function enforcePlanEntitlements(req, res, next) {
    if (req.method === 'OPTIONS' || isAuthRoute(req)) {
        next();
        return;
    }
    const companyId = req.companyId;
    if (!companyId) {
        next();
        return;
    }
    const feature = featureForEntitlementPath(req.path ?? '');
    if (!feature || isPlanEntitled(companyId, feature)) {
        next();
        return;
    }
    res.status(403).json({
        error: `${feature} is not included in this company's plan`,
        code: 'FEATURE_NOT_ENTITLED',
        feature,
    });
}
