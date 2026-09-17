"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_STRIPE_WEBHOOK_SECRET = exports.LOCAL_STRIPE_SECRET = void 0;
exports.stripeAdapter = stripeAdapter;
exports.resetLocalStripeSessions = resetLocalStripeSessions;
exports.billingProviderName = billingProviderName;
exports.setStripeTransport = setStripeTransport;
exports.resetStripeTransport = resetStripeTransport;
exports.verifyStripeSignature = verifyStripeSignature;
exports.signStripePayload = signStripePayload;
exports.confirmLocalStripeCheckout = confirmLocalStripeCheckout;
exports.createBillingCheckout = createBillingCheckout;
exports.applyStripeCheckoutEvent = applyStripeCheckoutEvent;
const node_crypto_1 = require("node:crypto");
const control_plane_js_1 = require("./control-plane.js");
exports.LOCAL_STRIPE_SECRET = 'sk_test_invexa_local';
exports.LOCAL_STRIPE_WEBHOOK_SECRET = 'whsec_invexa_local';
const defaultStripeTransport = async (url, init) => {
    const response = await fetch(url, init);
    return { status: response.status, json: async () => await response.json() };
};
let stripeTransport = defaultStripeTransport;
const localSessions = new Map();
function stripeAdapter() {
    const key = process.env.STRIPE_SECRET_KEY ?? '';
    if (key === exports.LOCAL_STRIPE_SECRET) {
        return process.env.NODE_ENV === 'production' ? 'manual' : 'local';
    }
    if (key)
        return 'stripe';
    return 'manual';
}
function resetLocalStripeSessions() {
    localSessions.clear();
}
function billingProviderName() {
    return stripeAdapter() === 'manual' ? 'manual' : 'stripe';
}
function setStripeTransport(next) {
    stripeTransport = next;
}
function resetStripeTransport() {
    stripeTransport = defaultStripeTransport;
}
function verifyStripeSignature(secret, payload, header) {
    const pairs = header.split(',').map((part) => part.trim().split('='));
    const timestamp = pairs.find(([key]) => key === 't')?.[1];
    const signature = pairs.find(([key]) => key === 'v1')?.[1];
    if (!timestamp || !signature)
        return false;
    const expected = (0, node_crypto_1.createHmac)('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    return expectedBuf.length === actualBuf.length && (0, node_crypto_1.timingSafeEqual)(expectedBuf, actualBuf);
}
function signStripePayload(secret, payload, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = (0, node_crypto_1.createHmac)('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    return `t=${timestamp},v1=${signature}`;
}
function unpaidInvoice(scope, companyId) {
    const existing = control_plane_js_1.controlPlane.listInvoices(companyId).find((invoice) => invoice.status === 'open' || invoice.status === 'past_due');
    return existing ?? control_plane_js_1.controlPlane.issueInvoice(scope, companyId);
}
async function ensureStripeCustomer(companyId) {
    const billing = control_plane_js_1.controlPlane.billing.get(companyId);
    if (billing?.stripeCustomerId)
        return billing.stripeCustomerId;
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret)
        return undefined;
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
    if (typeof payload.id !== 'string')
        return undefined;
    if (billing) {
        billing.stripeCustomerId = payload.id;
        control_plane_js_1.controlPlane.billing.set(companyId, billing);
    }
    return payload.id;
}
async function createStripeCheckoutSession(input) {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret)
        throw new control_plane_js_1.ControlPlaneError('Stripe is not configured', 'STRIPE_NOT_CONFIGURED', 503);
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
    if (customer)
        body.set('customer', customer);
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
        throw new control_plane_js_1.ControlPlaneError('Stripe checkout could not be created', 'STRIPE_CHECKOUT_FAILED', 502);
    }
    return { id: payload.id, url: payload.url };
}
async function createLocalCheckoutSession(input) {
    const id = `cs_local_${input.invoiceId}`;
    const origin = new URL(input.successUrl).origin;
    const url = `${origin}/#/control?stripeSession=${id}`;
    localSessions.set(id, { invoiceId: input.invoiceId, companyId: input.companyId });
    return { id, url };
}
function confirmLocalStripeCheckout(scope, sessionId) {
    if (stripeAdapter() !== 'local') {
        throw new control_plane_js_1.ControlPlaneError('Local Stripe confirm is not available', 'STRIPE_CONFIRM_UNAVAILABLE', 409);
    }
    const session = localSessions.get(sessionId);
    if (!session)
        throw new control_plane_js_1.ControlPlaneError('Stripe checkout session was not found', 'STRIPE_SESSION_MISSING', 404);
    if (scope.sessionType !== 'platform' || scope.companyId)
        control_plane_js_1.controlPlane.assertCompanyScope(scope, session.companyId);
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
async function createBillingCheckout(scope, companyId, urls) {
    const invoice = unpaidInvoice(scope, companyId);
    const snapshot = control_plane_js_1.controlPlane.billingSnapshot(companyId);
    const adapter = stripeAdapter();
    if (adapter === 'manual' || invoice.amount <= 0) {
        return {
            provider: billingProviderName(),
            adapter,
            mode: 'manual',
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
        provider: 'stripe',
        adapter,
        mode: 'checkout',
        url: session.url,
        sessionId: session.id,
        invoice,
        ...snapshot,
    };
}
function applyStripeCheckoutEvent(payload) {
    const type = String(payload.type ?? '');
    if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') {
        throw new control_plane_js_1.ControlPlaneError('Unsupported Stripe event', 'STRIPE_EVENT_IGNORED', 400);
    }
    const object = (payload.data && typeof payload.data === 'object' ? payload.data.object : undefined) ?? {};
    const paymentStatus = String(object.payment_status ?? 'paid');
    if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
        throw new control_plane_js_1.ControlPlaneError('Stripe payment is not complete', 'STRIPE_PAYMENT_INCOMPLETE', 409);
    }
    const metadata = object.metadata && typeof object.metadata === 'object' ? object.metadata : {};
    const invoiceId = String(object.client_reference_id ?? metadata.invoiceId ?? '');
    if (!invoiceId)
        throw new control_plane_js_1.ControlPlaneError('Stripe event is missing invoice id', 'STRIPE_INVOICE_MISSING', 400);
    const invoiceRecord = control_plane_js_1.controlPlane.invoices.get(invoiceId);
    if (invoiceRecord && typeof object.id === 'string') {
        invoiceRecord.stripeCheckoutSessionId = object.id;
    }
    if (invoiceRecord && typeof metadata.companyId === 'string' && metadata.companyId !== invoiceRecord.companyId) {
        throw new control_plane_js_1.ControlPlaneError('Stripe company does not match invoice', 'COMPANY_SCOPE_MISMATCH', 403);
    }
    const scope = control_plane_js_1.controlPlane.createScope({ actorId: 'stripe', sessionType: 'platform', actorType: 'system' });
    const invoice = control_plane_js_1.controlPlane.payInvoice(scope, invoiceId);
    return { invoiceId, invoice };
}
