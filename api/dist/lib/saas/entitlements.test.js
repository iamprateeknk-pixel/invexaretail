"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const entitlements_js_1 = require("./entitlements.js");
(0, node_test_1.default)('OMS, analytics and integrations paths map to plan features', () => {
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/orders'), 'OMS');
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/orders/ord-1/fulfill'), 'OMS');
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/intelligence/loc-1'), 'ANALYTICS');
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/webhook-subscriptions'), 'INTEGRATIONS');
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/purchase-orders'), 'PURCHASING');
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/transfers/list'), 'WMS');
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/items'), 'INVENTORY');
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/auth/login'), null);
    strict_1.default.equal((0, entitlements_js_1.featureForEntitlementPath)('/dashboard'), null);
});
(0, node_test_1.default)('starter companies are not entitled to OMS and hide channel-order navigation', () => {
    strict_1.default.equal((0, entitlements_js_1.isPlanEntitled)('company-jaipur', 'OMS'), false);
    strict_1.default.equal((0, entitlements_js_1.isPlanEntitled)('company-jaipur', 'INVENTORY'), true);
    strict_1.default.equal((0, entitlements_js_1.isPlanEntitled)('default-company', 'OMS'), true);
    const hidden = (0, entitlements_js_1.hiddenNavigationForModules)({
        OMS: false,
        ANALYTICS: false,
        INTEGRATIONS: false,
        PURCHASING: true,
        WMS: true,
        INVENTORY: true,
        ADVANCED_WORKFLOW: false,
    });
    strict_1.default.equal(hidden.includes('orders'), true);
    strict_1.default.equal(hidden.includes('intelligence'), true);
    strict_1.default.equal(hidden.includes('integrations'), true);
    strict_1.default.equal(hidden.includes('transfers'), false);
});
