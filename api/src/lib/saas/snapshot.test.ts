import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane, ControlPlaneError } from './control-plane.js';
import {
  applyControlPlaneSnapshot,
  isControlPlaneSnapshot,
  serializeControlPlane,
} from './snapshot.js';

test('published Studio config survives serialize and restore', () => {
  const plane = new ControlPlane();
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const selected = plane.selectCompany(login.user.id, 'default-company');
  const scope = plane.requireControlSession(selected.token).scope;
  plane.addStockColumn(scope, { name: 'Minimum Stock', key: 'minimum_stock', type: 'number' });
  plane.publish(scope);
  assert.equal(plane.runtimeConfig('default-company').page.columns.some((column) => column.key === 'minimum_stock'), true);

  const snapshot = serializeControlPlane(plane);
  const restored = new ControlPlane();
  applyControlPlaneSnapshot(restored, snapshot);

  assert.equal(restored.companies.get('default-company')?.planId, 'pro');
  assert.equal(restored.runtimeConfig('default-company').page.columns.some((column) => column.key === 'minimum_stock'), true);
  assert.equal(restored.runtimeConfig('company-jaipur').page.columns.some((column) => column.key === 'minimum_stock'), false);
  assert.equal(restored.platformUsers.get('platform-super-1')?.email, 'superadmin@invexa.local');
  assert.ok(restored.audit.some((event) => event.action === 'CONFIG_PUBLISHED'));
  assert.equal(isControlPlaneSnapshot(snapshot), true);
});

test('restored control sessions remain hard-locked after restart', () => {
  const plane = new ControlPlane();
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const first = plane.selectCompany(login.user.id, 'default-company');
  const snapshot = serializeControlPlane(plane);
  const restored = new ControlPlane();
  applyControlPlaneSnapshot(restored, snapshot);
  const live = restored.sessions.get(first.session.id);
  assert.equal(live?.status, 'active');
  assert.equal(live?.companyId, 'default-company');
  const resumed = restored.requireControlSession(first.token);
  assert.equal(resumed.scope.companyId, 'default-company');
});

test('code-defined plans missing from an older snapshot are merged back in', () => {
  const plane = new ControlPlane();
  const snapshot = serializeControlPlane(plane);
  snapshot.plans = snapshot.plans.filter((plan) => plan.id !== 'enterprise');
  const restored = new ControlPlane();
  applyControlPlaneSnapshot(restored, snapshot);
  assert.equal(restored.plans.has('enterprise'), true);
  assert.equal(restored.plans.get('starter')?.limits.max_users, 25);
});

test('issued invoices and past-due holds survive serialize and restore', () => {
  const plane = new ControlPlane();
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const selected = plane.selectCompany(login.user.id, 'default-company');
  const scope = plane.requireControlSession(selected.token).scope;
  const invoice = plane.issueInvoice(scope, 'default-company');
  plane.markInvoicePastDue(scope, invoice.id);
  assert.equal(plane.billingSnapshot('default-company').billing.subscription, 'past_due');

  const restored = new ControlPlane();
  applyControlPlaneSnapshot(restored, serializeControlPlane(plane));
  assert.equal(restored.invoices.get(invoice.id)?.status, 'past_due');
  assert.equal(restored.billingSnapshot('default-company').billing.subscription, 'past_due');
  assert.throws(
    () => restored.publish(scope),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'BILLING_HOLD',
  );
});

test('isControlPlaneSnapshot rejects unrelated JSON', () => {
  assert.equal(isControlPlaneSnapshot(null), false);
  assert.equal(isControlPlaneSnapshot({ version: 2, companies: [] }), false);
  assert.equal(isControlPlaneSnapshot({ version: 1 }), false);
});
