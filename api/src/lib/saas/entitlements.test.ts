import test from 'node:test';
import assert from 'node:assert/strict';
import {
  featureForEntitlementPath,
  hiddenNavigationForModules,
  isPlanEntitled,
} from './entitlements.js';
import { controlPlane } from './control-plane.js';

test('OMS, analytics and integrations paths map to plan features', () => {
  assert.equal(featureForEntitlementPath('/orders'), 'OMS');
  assert.equal(featureForEntitlementPath('/orders/ord-1/fulfill'), 'OMS');
  assert.equal(featureForEntitlementPath('/intelligence/loc-1'), 'ANALYTICS');
  assert.equal(featureForEntitlementPath('/webhook-subscriptions'), 'INTEGRATIONS');
  assert.equal(featureForEntitlementPath('/purchase-orders'), 'PURCHASING');
  assert.equal(featureForEntitlementPath('/transfers/list'), 'WMS');
  assert.equal(featureForEntitlementPath('/items'), 'INVENTORY');
  assert.equal(featureForEntitlementPath('/auth/login'), null);
  assert.equal(featureForEntitlementPath('/dashboard'), null);
});

test('starter companies are not entitled to OMS and hide channel-order navigation', () => {
  assert.equal(isPlanEntitled('company-jaipur', 'OMS'), false);
  assert.equal(isPlanEntitled('company-jaipur', 'INVENTORY'), true);
  assert.equal(isPlanEntitled('default-company', 'OMS'), true);
  const hidden = hiddenNavigationForModules({
    OMS: false,
    ANALYTICS: false,
    INTEGRATIONS: false,
    PURCHASING: true,
    WMS: true,
    INVENTORY: true,
    ADVANCED_WORKFLOW: false,
  });
  assert.equal(hidden.includes('orders'), true);
  assert.equal(hidden.includes('intelligence'), true);
  assert.equal(hidden.includes('integrations'), true);
  assert.equal(hidden.includes('transfers'), false);
});
