import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findPlan,
  planAllows,
  provisionTenant,
  resetSaasStore,
  slugifyTenantName,
  tenantAllows,
  validateOnboardInput,
} from './saas.js';

test('starter plan does not include OMS or connectors; growth does', () => {
  const starter = findPlan('starter');
  const growth = findPlan('growth');
  assert.equal(planAllows(starter, 'counts'), true);
  assert.equal(planAllows(starter, 'oms'), false);
  assert.equal(planAllows(growth, 'oms'), true);
  assert.equal(planAllows(growth, 'connectors'), true);
});

test('validateOnboardInput rejects a blank company and an unknown plan', () => {
  assert.ok(validateOnboardInput({ companyName: '', adminName: 'A', adminEmail: 'a@b.com', planCode: 'starter' }));
  assert.ok(validateOnboardInput({ companyName: 'Acme', adminName: 'A', adminEmail: 'not-an-email', planCode: 'starter' }));
  assert.ok(validateOnboardInput({ companyName: 'Acme', adminName: 'A', adminEmail: 'a@b.com', planCode: 'gold' }));
  assert.equal(validateOnboardInput({ companyName: 'Acme Stores', adminName: 'Ada', adminEmail: 'ada@acme.test', planCode: 'growth' }), null);
});

test('provisionTenant creates a trial subscription and unique slug', () => {
  resetSaasStore();
  const first = provisionTenant({ companyName: 'Acme Stores', adminName: 'Ada', adminEmail: 'ada@acme.test', planCode: 'growth' });
  const second = provisionTenant({ companyName: 'Acme Stores', adminName: 'Bea', adminEmail: 'bea@acme.test', planCode: 'starter' });
  assert.equal(first.tenant.slug, 'acme-stores');
  assert.equal(second.tenant.slug, 'acme-stores-2');
  assert.equal(first.subscription.status, 'TRIAL');
  assert.equal(tenantAllows(first.tenant.id, 'oms'), true);
  assert.equal(tenantAllows(second.tenant.id, 'oms'), false);
});

test('slugifyTenantName strips punctuation', () => {
  assert.equal(slugifyTenantName('  Invexa Retail — North  '), 'invexa-retail-north');
});
