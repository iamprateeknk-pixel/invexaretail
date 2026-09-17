import test from 'node:test';
import assert from 'node:assert/strict';
import { controlPlane } from './control-plane.js';
import {
  applyStripeCheckoutEvent,
  billingProviderName,
  confirmLocalStripeCheckout,
  createBillingCheckout,
  LOCAL_STRIPE_SECRET,
  resetLocalStripeSessions,
  resetStripeTransport,
  setStripeTransport,
  signStripePayload,
  stripeAdapter,
  verifyStripeSignature,
} from './billing-provider.js';

test('Stripe signatures verify the timestamped payload', () => {
  const payload = '{"id":"evt_1"}';
  const header = signStripePayload('whsec_test', payload, 1_700_000_000);
  assert.equal(verifyStripeSignature('whsec_test', payload, header), true);
  assert.equal(verifyStripeSignature('whsec_other', payload, header), false);
  assert.equal(verifyStripeSignature('whsec_test', payload, 't=1,v1=00'), false);
});

test('checkout stays manual without a Stripe secret', async () => {
  const previous = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  controlPlane.reset();
  try {
    assert.equal(billingProviderName(), 'manual');
    assert.equal(stripeAdapter(), 'manual');
    const scope = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'control', companyId: 'default-company' });
    const result = await createBillingCheckout(scope, 'default-company');
    assert.equal(result.provider, 'manual');
    assert.equal(result.adapter, 'manual');
    assert.equal(result.mode, 'manual');
    assert.equal('url' in result, false);
  } finally {
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
  }
});

test('checkout uses Stripe transport when a secret and amount are present', async () => {
  const previous = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_invexa';
  controlPlane.reset();
  setStripeTransport(async (url, init) => {
    if (url.includes('/v1/customers')) {
      return { status: 200, json: async () => ({ id: 'cus_test_unit' }) };
    }
    assert.equal(init.method, 'POST');
    assert.match(init.body, /metadata%5BinvoiceId%5D/);
    return { status: 200, json: async () => ({ id: 'cs_test_unit', url: 'https://checkout.stripe.com/c/pay/cs_test_unit' }) };
  });
  try {
    const scope = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'control', companyId: 'default-company' });
    const result = await createBillingCheckout(scope, 'default-company', {
      successUrl: 'http://localhost:5173/#/control',
      cancelUrl: 'http://localhost:5173/#/control',
    });
    assert.equal(result.provider, 'stripe');
    assert.equal(result.adapter, 'stripe');
    assert.equal(result.mode, 'checkout');
    if (result.mode !== 'checkout') throw new Error('expected Stripe checkout mode');
    assert.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_test_unit');
    assert.equal(result.sessionId, 'cs_test_unit');
    assert.equal(result.invoice.stripeCheckoutSessionId, 'cs_test_unit');
    assert.equal(controlPlane.billing.get('default-company')?.stripeCustomerId, 'cus_test_unit');
  } finally {
    resetStripeTransport();
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
  }
});

test('completed Stripe checkout events pay the referenced invoice', () => {
  controlPlane.reset();
  const platform = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  const invoice = controlPlane.issueInvoice(platform, 'default-company');
  controlPlane.markInvoicePastDue(platform, invoice.id);
  const paid = applyStripeCheckoutEvent({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: invoice.id, payment_status: 'paid', metadata: { invoiceId: invoice.id } } },
  });
  assert.equal(paid.invoice.status, 'paid');
  assert.equal(controlPlane.billing.get('default-company')?.subscription, 'active');
  const again = applyStripeCheckoutEvent({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: invoice.id, payment_status: 'paid', metadata: { invoiceId: invoice.id } } },
  });
  assert.equal(again.invoice.status, 'paid');
});

test('unpaid Stripe checkout events do not mark the invoice paid', () => {
  controlPlane.reset();
  const platform = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  const invoice = controlPlane.issueInvoice(platform, 'default-company');
  assert.throws(
    () => applyStripeCheckoutEvent({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: invoice.id, payment_status: 'unpaid', metadata: { invoiceId: invoice.id } } },
    }),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'STRIPE_PAYMENT_INCOMPLETE',
  );
  assert.equal(controlPlane.invoices.get(invoice.id)?.status, 'open');
});

test('local Stripe adapter checkout can be confirmed without Stripe Inc', async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousEnv = process.env.NODE_ENV;
  process.env.STRIPE_SECRET_KEY = LOCAL_STRIPE_SECRET;
  process.env.NODE_ENV = 'development';
  controlPlane.reset();
  resetLocalStripeSessions();
  try {
    assert.equal(stripeAdapter(), 'local');
    assert.equal(billingProviderName(), 'stripe');
    const scope = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'control', companyId: 'default-company' });
    const result = await createBillingCheckout(scope, 'default-company', {
      successUrl: 'http://localhost:5173/#/control',
    });
    assert.equal(result.adapter, 'local');
    assert.equal(result.mode, 'checkout');
    if (result.mode !== 'checkout') throw new Error('expected local checkout mode');
    assert.match(result.url, /stripeSession=cs_local_/);
    assert.equal(result.sessionId, `cs_local_${result.invoice.id}`);
    controlPlane.markInvoicePastDue(scope, result.invoice.id);
    const paid = confirmLocalStripeCheckout(scope, result.sessionId);
    assert.equal(paid.invoice.status, 'paid');
    assert.equal(controlPlane.billing.get('default-company')?.subscription, 'active');
  } finally {
    resetLocalStripeSessions();
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

test('production treats the local Stripe key as manual billing', async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousEnv = process.env.NODE_ENV;
  process.env.STRIPE_SECRET_KEY = LOCAL_STRIPE_SECRET;
  process.env.NODE_ENV = 'production';
  controlPlane.reset();
  try {
    assert.equal(stripeAdapter(), 'manual');
    assert.equal(billingProviderName(), 'manual');
    const scope = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'control', companyId: 'default-company' });
    const result = await createBillingCheckout(scope, 'default-company');
    assert.equal(result.mode, 'manual');
    assert.throws(
      () => confirmLocalStripeCheckout(scope, 'cs_local_missing'),
      (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'STRIPE_CONFIRM_UNAVAILABLE',
    );
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});
