import { createHmac, timingSafeEqual } from 'node:crypto';
import { ControlPlaneError, controlPlane, type ScopeContext } from './control-plane.js';

export const LOCAL_STRIPE_SECRET = 'sk_test_invexa_local';
export const LOCAL_STRIPE_WEBHOOK_SECRET = 'whsec_invexa_local';

export type BillingProviderName = 'manual' | 'stripe';
export type StripeAdapter = 'manual' | 'stripe' | 'local';

export type StripeTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json: () => Promise<Record<string, unknown>> }>;

const defaultStripeTransport: StripeTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, json: async () => await response.json() as Record<string, unknown> };
};

let stripeTransport: StripeTransport = defaultStripeTransport;

const localSessions = new Map<string, { invoiceId: string; companyId: string }>();

export function stripeAdapter(): StripeAdapter {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (key === LOCAL_STRIPE_SECRET) {
    return process.env.NODE_ENV === 'production' ? 'manual' : 'local';
  }
  if (key) return 'stripe';
  return 'manual';
}

export function resetLocalStripeSessions(): void {
  localSessions.clear();
}

export function billingProviderName(): BillingProviderName {
  return stripeAdapter() === 'manual' ? 'manual' : 'stripe';
}

export function setStripeTransport(next: StripeTransport): void {
  stripeTransport = next;
}

export function resetStripeTransport(): void {
  stripeTransport = defaultStripeTransport;
}

export function verifyStripeSignature(secret: string, payload: string, header: string): boolean {
  const pairs = header.split(',').map((part) => part.trim().split('='));
  const timestamp = pairs.find(([key]) => key === 't')?.[1];
  const signature = pairs.find(([key]) => key === 'v1')?.[1];
  if (!timestamp || !signature) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

export function signStripePayload(secret: string, payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function unpaidInvoice(scope: ScopeContext, companyId: string) {
  const existing = controlPlane.listInvoices(companyId).find((invoice) => invoice.status === 'open' || invoice.status === 'past_due');
  return existing ?? controlPlane.issueInvoice(scope, companyId);
}

async function ensureStripeCustomer(companyId: string): Promise<string | undefined> {
  const billing = controlPlane.billing.get(companyId);
  if (billing?.stripeCustomerId) return billing.stripeCustomerId;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return undefined;
  const response = await stripeTransport('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      name: companyId,
      'metadata[companyId]': companyId,
    }).toString(),
  });
  const payload = await response.json();
  if (typeof payload.id !== 'string') return undefined;
  if (billing) {
    billing.stripeCustomerId = payload.id;
    controlPlane.billing.set(companyId, billing);
  }
  return payload.id;
}

async function createStripeCheckoutSession(input: {
  invoiceId: string;
  companyId: string;
  amount: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new ControlPlaneError('Stripe is not configured', 'STRIPE_NOT_CONFIGURED', 503);
  const customer = await ensureStripeCustomer(input.companyId);
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.invoiceId,
    'metadata[invoiceId]': input.invoiceId,
    'metadata[companyId]': input.companyId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'inr',
    'line_items[0][price_data][unit_amount]': String(Math.max(100, input.amount * 100)),
    'line_items[0][price_data][product_data][name]': `Invexa ${input.companyId} subscription`,
  });
  if (customer) body.set('customer', customer);
  const response = await stripeTransport('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const payload = await response.json();
  if (response.status >= 400 || typeof payload.url !== 'string' || typeof payload.id !== 'string') {
    throw new ControlPlaneError('Stripe checkout could not be created', 'STRIPE_CHECKOUT_FAILED', 502);
  }
  return { id: payload.id, url: payload.url };
}

async function createLocalCheckoutSession(input: {
  invoiceId: string;
  companyId: string;
  successUrl: string;
}): Promise<{ id: string; url: string }> {
  const id = `cs_local_${input.invoiceId}`;
  const origin = new URL(input.successUrl).origin;
  const url = `${origin}/#/control?stripeSession=${id}`;
  localSessions.set(id, { invoiceId: input.invoiceId, companyId: input.companyId });
  return { id, url };
}

export function confirmLocalStripeCheckout(scope: ScopeContext, sessionId: string) {
  if (stripeAdapter() !== 'local') {
    throw new ControlPlaneError('Local Stripe confirm is not available', 'STRIPE_CONFIRM_UNAVAILABLE', 409);
  }
  const session = localSessions.get(sessionId);
  if (!session) throw new ControlPlaneError('Stripe checkout session was not found', 'STRIPE_SESSION_MISSING', 404);
  if (scope.sessionType !== 'platform' || scope.companyId) controlPlane.assertCompanyScope(scope, session.companyId);
  return applyStripeCheckoutEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_status: 'paid',
        client_reference_id: session.invoiceId,
        metadata: { invoiceId: session.invoiceId, companyId: session.companyId },
      },
    },
  });
}

export async function createBillingCheckout(scope: ScopeContext, companyId: string, urls?: { successUrl?: string; cancelUrl?: string }) {
  const invoice = unpaidInvoice(scope, companyId);
  const snapshot = controlPlane.billingSnapshot(companyId);
  const adapter = stripeAdapter();
  if (adapter === 'manual' || invoice.amount <= 0) {
    return {
      provider: billingProviderName(),
      adapter,
      mode: 'manual' as const,
      invoice,
      ...snapshot,
    };
  }
  const origin = urls?.successUrl ? new URL(urls.successUrl).origin : 'http://localhost:5173';
  const successUrl = urls?.successUrl ?? `${origin}/#/control`;
  const session = adapter === 'local'
    ? await createLocalCheckoutSession({ invoiceId: invoice.id, companyId, successUrl })
    : await createStripeCheckoutSession({
      invoiceId: invoice.id,
      companyId,
      amount: invoice.amount,
      successUrl,
      cancelUrl: urls?.cancelUrl ?? `${origin}/#/control`,
    });
  invoice.stripeCheckoutSessionId = session.id;
  return {
    provider: 'stripe' as const,
    adapter,
    mode: 'checkout' as const,
    url: session.url,
    sessionId: session.id,
    invoice,
    ...snapshot,
  };
}

export function applyStripeCheckoutEvent(payload: Record<string, unknown>): { invoiceId: string; invoice: ReturnType<typeof controlPlane.payInvoice> } {
  const type = String(payload.type ?? '');
  if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') {
    throw new ControlPlaneError('Unsupported Stripe event', 'STRIPE_EVENT_IGNORED', 400);
  }
  const object = (payload.data && typeof payload.data === 'object' ? (payload.data as { object?: Record<string, unknown> }).object : undefined) ?? {};
  const paymentStatus = String(object.payment_status ?? 'paid');
  if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
    throw new ControlPlaneError('Stripe payment is not complete', 'STRIPE_PAYMENT_INCOMPLETE', 409);
  }
  const metadata = object.metadata && typeof object.metadata === 'object' ? object.metadata as Record<string, unknown> : {};
  const invoiceId = String(object.client_reference_id ?? metadata.invoiceId ?? '');
  if (!invoiceId) throw new ControlPlaneError('Stripe event is missing invoice id', 'STRIPE_INVOICE_MISSING', 400);
  const invoiceRecord = controlPlane.invoices.get(invoiceId);
  if (invoiceRecord && typeof object.id === 'string') {
    invoiceRecord.stripeCheckoutSessionId = object.id;
  }
  if (invoiceRecord && typeof metadata.companyId === 'string' && metadata.companyId !== invoiceRecord.companyId) {
    throw new ControlPlaneError('Stripe company does not match invoice', 'COMPANY_SCOPE_MISMATCH', 403);
  }
  const scope = controlPlane.createScope({ actorId: 'stripe', sessionType: 'platform', actorType: 'system' });
  const invoice = controlPlane.payInvoice(scope, invoiceId);
  return { invoiceId, invoice };
}
