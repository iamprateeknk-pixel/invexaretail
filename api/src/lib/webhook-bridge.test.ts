import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane } from './saas/control-plane.js';
import { controlPlane } from './saas/control-plane.js';
import { listControlPlaneWebhookTargets, resolveCompanyIdFromEvent } from './webhook-bridge.js';
import {
  dispatchWebhookEvent,
  resetWebhookTransport,
  setWebhookTransport,
} from './webhook-dispatcher.js';
import { resetWebhookStore } from './webhook-store.js';

test('event company is resolved from location then item ownership', () => {
  assert.equal(resolveCompanyIdFromEvent({ locationId: 'loc-1' }), 'default-company');
  assert.equal(resolveCompanyIdFromEvent({ locationId: 'loc-jaipur-1' }), 'company-jaipur');
  assert.equal(resolveCompanyIdFromEvent({ itemId: 'item-jaipur-1' }), 'company-jaipur');
});

test('Control Plane webhooks receive operational events only for their company', async () => {
  resetWebhookStore();
  controlPlane.reset();
  const plane = controlPlane;
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const grocery = plane.selectCompany(login.user.id, 'default-company');
  const groceryScope = plane.requireControlSession(grocery.token).scope;
  const created = plane.createWebhook(groceryScope, 'https://hooks.example.com/grocery', ['count.reviewed'], 'Grocery ops');
  plane.webhooks.set('hook-jaipur', {
    id: 'hook-jaipur',
    companyId: 'company-jaipur',
    name: 'Jaipur ops',
    url: 'https://hooks.example.com/jaipur',
    events: ['count.reviewed'],
    status: 'active',
    signingSecret: 'jaipur-secret',
    createdAt: new Date().toISOString(),
  });

  const calls: string[] = [];
  setWebhookTransport(async (url) => {
    calls.push(url);
    return { status: 204 };
  });
  try {
    const delivered = await dispatchWebhookEvent({
      type: 'count.reviewed',
      entityId: 'count-1',
      data: { countId: 'count-1', locationId: 'loc-1', status: 'APPROVED' },
    });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].status, 'DELIVERED');
    assert.deepEqual(calls, ['https://hooks.example.com/grocery']);
    assert.equal(listControlPlaneWebhookTargets('default-company', 'count.reviewed').some((hook) => hook.id === created.id), true);
    assert.equal(listControlPlaneWebhookTargets('company-jaipur', 'count.reviewed').some((hook) => hook.id === 'hook-jaipur'), true);
  } finally {
    resetWebhookTransport();
  }
});

test('Starter cannot register Control Plane webhooks', () => {
  const plane = new ControlPlane();
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const jaipur = plane.selectCompany(login.user.id, 'company-jaipur');
  const scope = plane.requireControlSession(jaipur.token).scope;
  assert.throws(
    () => plane.createWebhook(scope, 'https://hooks.example.com/jaipur', ['stock.low'], 'Jaipur'),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'FEATURE_NOT_ENTITLED',
  );
});
