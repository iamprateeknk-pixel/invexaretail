"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const control_plane_js_1 = require("./control-plane.js");
const billing_provider_js_1 = require("./billing-provider.js");
(0, node_test_1.default)('Stripe signatures verify the timestamped payload', () => {
    const payload = '{"id":"evt_1"}';
    const header = (0, billing_provider_js_1.signStripePayload)('whsec_test', payload, 1_700_000_000);
    strict_1.default.equal((0, billing_provider_js_1.verifyStripeSignature)('whsec_test', payload, header), true);
    strict_1.default.equal((0, billing_provider_js_1.verifyStripeSignature)('whsec_other', payload, header), false);
    strict_1.default.equal((0, billing_provider_js_1.verifyStripeSignature)('whsec_test', payload, 't=1,v1=00'), false);
});
(0, node_test_1.default)('checkout stays manual without a Stripe secret', async () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    control_plane_js_1.controlPlane.reset();
    try {
        strict_1.default.equal((0, billing_provider_js_1.billingProviderName)(), 'manual');
        strict_1.default.equal((0, billing_provider_js_1.stripeAdapter)(), 'manual');
        const scope = control_plane_js_1.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'control', companyId: 'default-company' });
        const result = await (0, billing_provider_js_1.createBillingCheckout)(scope, 'default-company');
        strict_1.default.equal(result.provider, 'manual');
        strict_1.default.equal(result.adapter, 'manual');
        strict_1.default.equal(result.mode, 'manual');
        strict_1.default.equal('url' in result, false);
    }
    finally {
        if (previous === undefined)
            delete process.env.STRIPE_SECRET_KEY;
        else
            process.env.STRIPE_SECRET_KEY = previous;
    }
});
(0, node_test_1.default)('checkout uses Stripe transport when a secret and amount are present', async () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_invexa';
    control_plane_js_1.controlPlane.reset();
    (0, billing_provider_js_1.setStripeTransport)(async (url, init) => {
        if (url.includes('/v1/customers')) {
            return { status: 200, json: async () => ({ id: 'cus_test_unit' }) };
        }
        strict_1.default.equal(init.method, 'POST');
        strict_1.default.match(init.body, /metadata%5BinvoiceId%5D/);
        return { status: 200, json: async () => ({ id: 'cs_test_unit', url: 'https://checkout.stripe.com/c/pay/cs_test_unit' }) };
    });
    try {
        const scope = control_plane_js_1.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'control', companyId: 'default-company' });
        const result = await (0, billing_provider_js_1.createBillingCheckout)(scope, 'default-company', {
            successUrl: 'http://localhost:5173/#/control',
            cancelUrl: 'http://localhost:5173/#/control',
        });
        strict_1.default.equal(result.provider, 'stripe');
        strict_1.default.equal(result.adapter, 'stripe');
        strict_1.default.equal(result.mode, 'checkout');
        if (result.mode !== 'checkout')
            throw new Error('expected Stripe checkout mode');
        strict_1.default.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_test_unit');
        strict_1.default.equal(result.sessionId, 'cs_test_unit');
        strict_1.default.equal(result.invoice.stripeCheckoutSessionId, 'cs_test_unit');
        strict_1.default.equal(control_plane_js_1.controlPlane.billing.get('default-company')?.stripeCustomerId, 'cus_test_unit');
    }
    finally {
        (0, billing_provider_js_1.resetStripeTransport)();
        if (previous === undefined)
            delete process.env.STRIPE_SECRET_KEY;
        else
            process.env.STRIPE_SECRET_KEY = previous;
    }
});
(0, node_test_1.default)('completed Stripe checkout events pay the referenced invoice', () => {
    control_plane_js_1.controlPlane.reset();
    const platform = control_plane_js_1.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    const invoice = control_plane_js_1.controlPlane.issueInvoice(platform, 'default-company');
    control_plane_js_1.controlPlane.markInvoicePastDue(platform, invoice.id);
    const paid = (0, billing_provider_js_1.applyStripeCheckoutEvent)({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: invoice.id, payment_status: 'paid', metadata: { invoiceId: invoice.id } } },
    });
    strict_1.default.equal(paid.invoice.status, 'paid');
    strict_1.default.equal(control_plane_js_1.controlPlane.billing.get('default-company')?.subscription, 'active');
    const again = (0, billing_provider_js_1.applyStripeCheckoutEvent)({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: invoice.id, payment_status: 'paid', metadata: { invoiceId: invoice.id } } },
    });
    strict_1.default.equal(again.invoice.status, 'paid');
});
(0, node_test_1.default)('unpaid Stripe checkout events do not mark the invoice paid', () => {
    control_plane_js_1.controlPlane.reset();
    const platform = control_plane_js_1.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    const invoice = control_plane_js_1.controlPlane.issueInvoice(platform, 'default-company');
    strict_1.default.throws(() => (0, billing_provider_js_1.applyStripeCheckoutEvent)({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: invoice.id, payment_status: 'unpaid', metadata: { invoiceId: invoice.id } } },
    }), (error) => error instanceof Error && 'code' in error && error.code === 'STRIPE_PAYMENT_INCOMPLETE');
    strict_1.default.equal(control_plane_js_1.controlPlane.invoices.get(invoice.id)?.status, 'open');
});
(0, node_test_1.default)('local Stripe adapter checkout can be confirmed without Stripe Inc', async () => {
    const previousKey = process.env.STRIPE_SECRET_KEY;
    const previousEnv = process.env.NODE_ENV;
    process.env.STRIPE_SECRET_KEY = billing_provider_js_1.LOCAL_STRIPE_SECRET;
    process.env.NODE_ENV = 'development';
    control_plane_js_1.controlPlane.reset();
    (0, billing_provider_js_1.resetLocalStripeSessions)();
    try {
        strict_1.default.equal((0, billing_provider_js_1.stripeAdapter)(), 'local');
        strict_1.default.equal((0, billing_provider_js_1.billingProviderName)(), 'stripe');
        const scope = control_plane_js_1.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'control', companyId: 'default-company' });
        const result = await (0, billing_provider_js_1.createBillingCheckout)(scope, 'default-company', {
            successUrl: 'http://localhost:5173/#/control',
        });
        strict_1.default.equal(result.adapter, 'local');
        strict_1.default.equal(result.mode, 'checkout');
        if (result.mode !== 'checkout')
            throw new Error('expected local checkout mode');
        strict_1.default.match(result.url, /stripeSession=cs_local_/);
        strict_1.default.equal(result.sessionId, `cs_local_${result.invoice.id}`);
        control_plane_js_1.controlPlane.markInvoicePastDue(scope, result.invoice.id);
        const paid = (0, billing_provider_js_1.confirmLocalStripeCheckout)(scope, result.sessionId);
        strict_1.default.equal(paid.invoice.status, 'paid');
        strict_1.default.equal(control_plane_js_1.controlPlane.billing.get('default-company')?.subscription, 'active');
    }
    finally {
        (0, billing_provider_js_1.resetLocalStripeSessions)();
        if (previousKey === undefined)
            delete process.env.STRIPE_SECRET_KEY;
        else
            process.env.STRIPE_SECRET_KEY = previousKey;
        if (previousEnv === undefined)
            delete process.env.NODE_ENV;
        else
            process.env.NODE_ENV = previousEnv;
    }
});
(0, node_test_1.default)('production treats the local Stripe key as manual billing', async () => {
    const previousKey = process.env.STRIPE_SECRET_KEY;
    const previousEnv = process.env.NODE_ENV;
    process.env.STRIPE_SECRET_KEY = billing_provider_js_1.LOCAL_STRIPE_SECRET;
    process.env.NODE_ENV = 'production';
    control_plane_js_1.controlPlane.reset();
    try {
        strict_1.default.equal((0, billing_provider_js_1.stripeAdapter)(), 'manual');
        strict_1.default.equal((0, billing_provider_js_1.billingProviderName)(), 'manual');
        const scope = control_plane_js_1.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'control', companyId: 'default-company' });
        const result = await (0, billing_provider_js_1.createBillingCheckout)(scope, 'default-company');
        strict_1.default.equal(result.mode, 'manual');
        strict_1.default.throws(() => (0, billing_provider_js_1.confirmLocalStripeCheckout)(scope, 'cs_local_missing'), (error) => error instanceof Error && 'code' in error && error.code === 'STRIPE_CONFIRM_UNAVAILABLE');
    }
    finally {
        if (previousKey === undefined)
            delete process.env.STRIPE_SECRET_KEY;
        else
            process.env.STRIPE_SECRET_KEY = previousKey;
        if (previousEnv === undefined)
            delete process.env.NODE_ENV;
        else
            process.env.NODE_ENV = previousEnv;
    }
});
