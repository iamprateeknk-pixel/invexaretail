import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Request } from 'express';
import { controlPlane } from '../lib/saas/control-plane.js';
import { LOCAL_STRIPE_SECRET, resetLocalStripeSessions, resetStripeTransport, setStripeTransport, signStripePayload } from '../lib/saas/billing-provider.js';
import { controlRouter, studioRouter, syncRouter } from './control-plane.js';

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  controlPlane.reset();
  const app = express();
  app.use(express.json({
    verify(req: Request, _res, buf: Buffer) {
      req.rawBody = buf.toString('utf8');
    },
  }));
  app.use('/control/v1', controlRouter);
  app.use('/studio/v1', studioRouter);
  app.use('/sync/v1', syncRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run(url);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function json(url: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

test('HTTP: platform login, company lock, studio publish and sync mutation', async () => {
  await withServer(async (url) => {
    const login = await json(url, '/control/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'superadmin@invexa.local', password: controlPlane.seedPassword }),
    });
    assert.equal(login.status, 200);
    const platformToken = login.body.token;

    const locked = await json(url, '/control/v1/sessions/select-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${platformToken}` },
      body: JSON.stringify({ companyId: 'default-company' }),
    });
    assert.equal(locked.status, 200);
    const controlToken = locked.body.token;
    const auth = { Authorization: `Bearer ${controlToken}` };

    const other = await json(url, '/control/v1/users', {
      method: 'GET',
      headers: { Authorization: `Bearer ${controlToken}` },
    });
    assert.equal(other.status, 200);

    const column = await json(url, '/studio/v1/draft/stock/columns', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Minimum Stock', key: 'minimum_stock', type: 'number' }),
    });
    assert.equal(column.status, 200);

    const published = await json(url, '/studio/v1/publish', { method: 'POST', headers: auth });
    assert.equal(published.status, 200);
    assert.equal(published.body.runtime.page.columns.some((entry: { key: string }) => entry.key === 'minimum_stock'), true);

    const jaipurRuntime = controlPlane.runtimeConfig('company-jaipur');
    assert.equal(jaipurRuntime.page.columns.some((entry) => entry.key === 'minimum_stock'), false);

    const mutation = await json(url, '/sync/v1/mutations', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        mutationId: 'http-mut-1',
        companyId: 'default-company',
        userId: 'user-store-1',
        deviceId: 'dev-1',
        actionType: 'STOCK_ADJUST',
        payload: { itemId: 'item-1', delta: -2 },
      }),
    });
    assert.equal(mutation.status, 200);
    assert.equal(mutation.body.mutation.status, 'synced');

    const cross = await json(url, '/sync/v1/mutations', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        mutationId: 'http-mut-2',
        companyId: 'company-jaipur',
        userId: 'user-store-1',
        deviceId: 'dev-1',
        actionType: 'STOCK_ADJUST',
        payload: { itemId: 'item-1', delta: -1 },
      }),
    });
    assert.equal(cross.status, 403);
    assert.equal(cross.body.code, 'COMPANY_SCOPE_MISMATCH');
  });
});

test('HTTP: past-due invoice holds Studio publish until payment', async () => {
  await withServer(async (url) => {
    const login = await json(url, '/control/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'superadmin@invexa.local', password: controlPlane.seedPassword }),
    });
    const locked = await json(url, '/control/v1/sessions/select-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.body.token}` },
      body: JSON.stringify({ companyId: 'default-company' }),
    });
    const auth = { Authorization: `Bearer ${locked.body.token}` };

    const issued = await json(url, '/control/v1/billing/invoices', { method: 'POST', headers: auth });
    assert.equal(issued.status, 201);
    const invoiceId = issued.body.invoice.id;

    const pastDue = await json(url, `/control/v1/billing/invoices/${invoiceId}/past-due`, { method: 'POST', headers: auth });
    assert.equal(pastDue.status, 200);
    assert.equal(pastDue.body.billing.subscription, 'past_due');

    const held = await json(url, '/studio/v1/publish', { method: 'POST', headers: auth });
    assert.equal(held.status, 402);
    assert.equal(held.body.code, 'BILLING_HOLD');

    const paid = await json(url, `/control/v1/billing/invoices/${invoiceId}/pay`, { method: 'POST', headers: auth });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.billing.subscription, 'active');

    const published = await json(url, '/studio/v1/publish', { method: 'POST', headers: auth });
    assert.equal(published.status, 200);
  });
});

test('HTTP: billing checkout stays manual without Stripe keys', async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    await withServer(async (url) => {
      const login = await json(url, '/control/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'superadmin@invexa.local', password: controlPlane.seedPassword }),
      });
      const locked = await json(url, '/control/v1/sessions/select-company', {
        method: 'POST',
        headers: { Authorization: `Bearer ${login.body.token}` },
        body: JSON.stringify({ companyId: 'default-company' }),
      });
      const auth = { Authorization: `Bearer ${locked.body.token}` };

      const checkout = await json(url, '/control/v1/billing/checkout', { method: 'POST', headers: auth });
      assert.equal(checkout.status, 201);
      assert.equal(checkout.body.provider, 'manual');
      assert.equal(checkout.body.adapter, 'manual');
      assert.equal(checkout.body.mode, 'manual');
      assert.equal(typeof checkout.body.invoice?.id, 'string');
    });
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
  }
});

test('HTTP: Stripe checkout URL and signed webhook pay the invoice', async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_test_invexa';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_invexa';
  setStripeTransport(async (url) => {
    if (url.includes('/v1/customers')) {
      return { status: 200, json: async () => ({ id: 'cus_test_1' }) };
    }
    return {
      status: 200,
      json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
    };
  });
  try {
    await withServer(async (url) => {
      const login = await json(url, '/control/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'superadmin@invexa.local', password: controlPlane.seedPassword }),
      });
      const locked = await json(url, '/control/v1/sessions/select-company', {
        method: 'POST',
        headers: { Authorization: `Bearer ${login.body.token}` },
        body: JSON.stringify({ companyId: 'default-company' }),
      });
      const auth = { Authorization: `Bearer ${locked.body.token}` };

      const checkout = await json(url, '/control/v1/billing/checkout', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          successUrl: 'http://localhost:5173/#/control',
          cancelUrl: 'http://localhost:5173/#/control',
        }),
      });
      assert.equal(checkout.status, 201);
      assert.equal(checkout.body.provider, 'stripe');
      assert.equal(checkout.body.adapter, 'stripe');
      assert.equal(checkout.body.mode, 'checkout');
      assert.equal(checkout.body.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
      const invoiceId = checkout.body.invoice.id as string;

      const pastDue = await json(url, `/control/v1/billing/invoices/${invoiceId}/past-due`, { method: 'POST', headers: auth });
      assert.equal(pastDue.status, 200);
      assert.equal(pastDue.body.billing.subscription, 'past_due');
      assert.equal(pastDue.body.provider, 'stripe');

      const event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: invoiceId,
            payment_status: 'paid',
            metadata: { invoiceId, companyId: 'default-company' },
          },
        },
      };
      const payload = JSON.stringify(event);
      const paid = await fetch(`${url}/control/v1/billing/webhooks/stripe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signStripePayload('whsec_invexa', payload),
        },
        body: payload,
      });
      const paidBody = await paid.json() as { invoice?: { status?: string }; billing?: { subscription?: string } };
      assert.equal(paid.status, 200);
      assert.equal(paidBody.invoice?.status, 'paid');
      assert.equal(paidBody.billing?.subscription, 'active');

      const bad = await fetch(`${url}/control/v1/billing/webhooks/stripe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=1,v1=deadbeef',
        },
        body: payload,
      });
      const badBody = await bad.json() as { code?: string };
      assert.equal(bad.status, 400);
      assert.equal(badBody.code, 'STRIPE_SIGNATURE_INVALID');
    });
  } finally {
    resetStripeTransport();
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
  }
});

test('HTTP: local Stripe checkout confirm pays the invoice', async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousEnv = process.env.NODE_ENV;
  process.env.STRIPE_SECRET_KEY = LOCAL_STRIPE_SECRET;
  process.env.NODE_ENV = 'development';
  resetLocalStripeSessions();
  try {
    await withServer(async (url) => {
      const login = await json(url, '/control/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'superadmin@invexa.local', password: controlPlane.seedPassword }),
      });
      const locked = await json(url, '/control/v1/sessions/select-company', {
        method: 'POST',
        headers: { Authorization: `Bearer ${login.body.token}` },
        body: JSON.stringify({ companyId: 'default-company' }),
      });
      const auth = { Authorization: `Bearer ${locked.body.token}` };

      const checkout = await json(url, '/control/v1/billing/checkout', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          successUrl: 'http://localhost:5173/#/control',
          cancelUrl: 'http://localhost:5173/#/control',
        }),
      });
      assert.equal(checkout.status, 201);
      assert.equal(checkout.body.adapter, 'local');
      assert.equal(checkout.body.mode, 'checkout');
      assert.match(String(checkout.body.url), /stripeSession=cs_local_/);
      const sessionId = checkout.body.sessionId as string;
      const invoiceId = checkout.body.invoice.id as string;

      const pastDue = await json(url, `/control/v1/billing/invoices/${invoiceId}/past-due`, { method: 'POST', headers: auth });
      assert.equal(pastDue.status, 200);
      assert.equal(pastDue.body.billing.subscription, 'past_due');

      const confirmed = await json(url, '/control/v1/billing/stripe/confirm', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ sessionId }),
      });
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.invoice?.status, 'paid');
      assert.equal(confirmed.body.billing?.subscription, 'active');
      assert.equal(confirmed.body.adapter, 'local');

      const missing = await json(url, '/control/v1/billing/stripe/confirm', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ sessionId: 'cs_local_missing' }),
      });
      assert.equal(missing.status, 404);
      assert.equal(missing.body.code, 'STRIPE_SESSION_MISSING');
    });
  } finally {
    resetLocalStripeSessions();
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

test('HTTP: Control Plane webhook returns the signing secret once', async () => {
  await withServer(async (url) => {
    const login = await json(url, '/control/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'superadmin@invexa.local', password: controlPlane.seedPassword }),
    });
    const grocery = await json(url, '/control/v1/sessions/select-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.body.token}` },
      body: JSON.stringify({ companyId: 'default-company' }),
    });
    const auth = { Authorization: `Bearer ${grocery.body.token}` };

    const created = await json(url, '/control/v1/integrations/webhooks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: 'Grocery ops',
        url: 'https://hooks.example.com/grocery',
        events: ['stock.low', 'count.reviewed'],
      }),
    });
    assert.equal(created.status, 201);
    assert.match(String(created.body.webhook?.signingSecret ?? ''), /^[a-f0-9]{64}$/);
    assert.equal(created.body.webhook?.url, 'https://hooks.example.com/grocery');

    const listed = await json(url, '/control/v1/integrations', { method: 'GET', headers: auth });
    assert.equal(listed.status, 200);
    const hook = (listed.body.webhooks as Array<Record<string, unknown>>).find((entry) => entry.id === created.body.webhook.id);
    assert.ok(hook);
    assert.equal('signingSecret' in (hook ?? {}), false);

    const jaipur = await json(url, '/control/v1/sessions/select-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.body.token}` },
      body: JSON.stringify({ companyId: 'company-jaipur' }),
    });
    const denied = await json(url, '/control/v1/integrations/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jaipur.body.token}` },
      body: JSON.stringify({
        name: 'Jaipur ops',
        url: 'https://hooks.example.com/jaipur',
        events: ['stock.low'],
      }),
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'FEATURE_NOT_ENTITLED');
  });
});
