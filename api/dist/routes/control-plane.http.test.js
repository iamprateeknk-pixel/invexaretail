"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const control_plane_js_1 = require("../lib/saas/control-plane.js");
const billing_provider_js_1 = require("../lib/saas/billing-provider.js");
const control_plane_js_2 = require("./control-plane.js");
async function withServer(run) {
    control_plane_js_1.controlPlane.reset();
    const app = (0, express_1.default)();
    app.use(express_1.default.json({
        verify(req, _res, buf) {
            req.rawBody = buf.toString('utf8');
        },
    }));
    app.use('/control/v1', control_plane_js_2.controlRouter);
    app.use('/studio/v1', control_plane_js_2.studioRouter);
    app.use('/sync/v1', control_plane_js_2.syncRouter);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const url = `http://127.0.0.1:${address.port}`;
    try {
        await run(url);
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}
async function json(url, path, options = {}) {
    const response = await fetch(`${url}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
}
(0, node_test_1.default)('HTTP: platform login, company lock, studio publish and sync mutation', async () => {
    await withServer(async (url) => {
        const login = await json(url, '/control/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'superadmin@invexa.local', password: control_plane_js_1.controlPlane.seedPassword }),
        });
        strict_1.default.equal(login.status, 200);
        const platformToken = login.body.token;
        const locked = await json(url, '/control/v1/sessions/select-company', {
            method: 'POST',
            headers: { Authorization: `Bearer ${platformToken}` },
            body: JSON.stringify({ companyId: 'default-company' }),
        });
        strict_1.default.equal(locked.status, 200);
        const controlToken = locked.body.token;
        const auth = { Authorization: `Bearer ${controlToken}` };
        const other = await json(url, '/control/v1/users', {
            method: 'GET',
            headers: { Authorization: `Bearer ${controlToken}` },
        });
        strict_1.default.equal(other.status, 200);
        const column = await json(url, '/studio/v1/draft/stock/columns', {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ name: 'Minimum Stock', key: 'minimum_stock', type: 'number' }),
        });
        strict_1.default.equal(column.status, 200);
        const published = await json(url, '/studio/v1/publish', { method: 'POST', headers: auth });
        strict_1.default.equal(published.status, 200);
        strict_1.default.equal(published.body.runtime.page.columns.some((entry) => entry.key === 'minimum_stock'), true);
        const jaipurRuntime = control_plane_js_1.controlPlane.runtimeConfig('company-jaipur');
        strict_1.default.equal(jaipurRuntime.page.columns.some((entry) => entry.key === 'minimum_stock'), false);
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
        strict_1.default.equal(mutation.status, 200);
        strict_1.default.equal(mutation.body.mutation.status, 'synced');
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
        strict_1.default.equal(cross.status, 403);
        strict_1.default.equal(cross.body.code, 'COMPANY_SCOPE_MISMATCH');
    });
});
(0, node_test_1.default)('HTTP: past-due invoice holds Studio publish until payment', async () => {
    await withServer(async (url) => {
        const login = await json(url, '/control/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'superadmin@invexa.local', password: control_plane_js_1.controlPlane.seedPassword }),
        });
        const locked = await json(url, '/control/v1/sessions/select-company', {
            method: 'POST',
            headers: { Authorization: `Bearer ${login.body.token}` },
            body: JSON.stringify({ companyId: 'default-company' }),
        });
        const auth = { Authorization: `Bearer ${locked.body.token}` };
        const issued = await json(url, '/control/v1/billing/invoices', { method: 'POST', headers: auth });
        strict_1.default.equal(issued.status, 201);
        const invoiceId = issued.body.invoice.id;
        const pastDue = await json(url, `/control/v1/billing/invoices/${invoiceId}/past-due`, { method: 'POST', headers: auth });
        strict_1.default.equal(pastDue.status, 200);
        strict_1.default.equal(pastDue.body.billing.subscription, 'past_due');
        const held = await json(url, '/studio/v1/publish', { method: 'POST', headers: auth });
        strict_1.default.equal(held.status, 402);
        strict_1.default.equal(held.body.code, 'BILLING_HOLD');
        const paid = await json(url, `/control/v1/billing/invoices/${invoiceId}/pay`, { method: 'POST', headers: auth });
        strict_1.default.equal(paid.status, 200);
        strict_1.default.equal(paid.body.billing.subscription, 'active');
        const published = await json(url, '/studio/v1/publish', { method: 'POST', headers: auth });
        strict_1.default.equal(published.status, 200);
    });
});
(0, node_test_1.default)('HTTP: billing checkout stays manual without Stripe keys', async () => {
    const previousKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
        await withServer(async (url) => {
            const login = await json(url, '/control/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: 'superadmin@invexa.local', password: control_plane_js_1.controlPlane.seedPassword }),
            });
            const locked = await json(url, '/control/v1/sessions/select-company', {
                method: 'POST',
                headers: { Authorization: `Bearer ${login.body.token}` },
                body: JSON.stringify({ companyId: 'default-company' }),
            });
            const auth = { Authorization: `Bearer ${locked.body.token}` };
            const checkout = await json(url, '/control/v1/billing/checkout', { method: 'POST', headers: auth });
            strict_1.default.equal(checkout.status, 201);
            strict_1.default.equal(checkout.body.provider, 'manual');
            strict_1.default.equal(checkout.body.adapter, 'manual');
            strict_1.default.equal(checkout.body.mode, 'manual');
            strict_1.default.equal(typeof checkout.body.invoice?.id, 'string');
        });
    }
    finally {
        if (previousKey === undefined)
            delete process.env.STRIPE_SECRET_KEY;
        else
            process.env.STRIPE_SECRET_KEY = previousKey;
    }
});
(0, node_test_1.default)('HTTP: Stripe checkout URL and signed webhook pay the invoice', async () => {
    const previousKey = process.env.STRIPE_SECRET_KEY;
    const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test_invexa';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_invexa';
    (0, billing_provider_js_1.setStripeTransport)(async (url) => {
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
                body: JSON.stringify({ email: 'superadmin@invexa.local', password: control_plane_js_1.controlPlane.seedPassword }),
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
            strict_1.default.equal(checkout.status, 201);
            strict_1.default.equal(checkout.body.provider, 'stripe');
            strict_1.default.equal(checkout.body.adapter, 'stripe');
            strict_1.default.equal(checkout.body.mode, 'checkout');
            strict_1.default.equal(checkout.body.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
            const invoiceId = checkout.body.invoice.id;
            const pastDue = await json(url, `/control/v1/billing/invoices/${invoiceId}/past-due`, { method: 'POST', headers: auth });
            strict_1.default.equal(pastDue.status, 200);
            strict_1.default.equal(pastDue.body.billing.subscription, 'past_due');
            strict_1.default.equal(pastDue.body.provider, 'stripe');
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
                    'stripe-signature': (0, billing_provider_js_1.signStripePayload)('whsec_invexa', payload),
                },
                body: payload,
            });
            const paidBody = await paid.json();
            strict_1.default.equal(paid.status, 200);
            strict_1.default.equal(paidBody.invoice?.status, 'paid');
            strict_1.default.equal(paidBody.billing?.subscription, 'active');
            const bad = await fetch(`${url}/control/v1/billing/webhooks/stripe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'stripe-signature': 't=1,v1=deadbeef',
                },
                body: payload,
            });
            const badBody = await bad.json();
            strict_1.default.equal(bad.status, 400);
            strict_1.default.equal(badBody.code, 'STRIPE_SIGNATURE_INVALID');
        });
    }
    finally {
        (0, billing_provider_js_1.resetStripeTransport)();
        if (previousKey === undefined)
            delete process.env.STRIPE_SECRET_KEY;
        else
            process.env.STRIPE_SECRET_KEY = previousKey;
        if (previousWebhook === undefined)
            delete process.env.STRIPE_WEBHOOK_SECRET;
        else
            process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
    }
});
(0, node_test_1.default)('HTTP: local Stripe checkout confirm pays the invoice', async () => {
    const previousKey = process.env.STRIPE_SECRET_KEY;
    const previousEnv = process.env.NODE_ENV;
    process.env.STRIPE_SECRET_KEY = billing_provider_js_1.LOCAL_STRIPE_SECRET;
    process.env.NODE_ENV = 'development';
    (0, billing_provider_js_1.resetLocalStripeSessions)();
    try {
        await withServer(async (url) => {
            const login = await json(url, '/control/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: 'superadmin@invexa.local', password: control_plane_js_1.controlPlane.seedPassword }),
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
            strict_1.default.equal(checkout.status, 201);
            strict_1.default.equal(checkout.body.adapter, 'local');
            strict_1.default.equal(checkout.body.mode, 'checkout');
            strict_1.default.match(String(checkout.body.url), /stripeSession=cs_local_/);
            const sessionId = checkout.body.sessionId;
            const invoiceId = checkout.body.invoice.id;
            const pastDue = await json(url, `/control/v1/billing/invoices/${invoiceId}/past-due`, { method: 'POST', headers: auth });
            strict_1.default.equal(pastDue.status, 200);
            strict_1.default.equal(pastDue.body.billing.subscription, 'past_due');
            const confirmed = await json(url, '/control/v1/billing/stripe/confirm', {
                method: 'POST',
                headers: auth,
                body: JSON.stringify({ sessionId }),
            });
            strict_1.default.equal(confirmed.status, 200);
            strict_1.default.equal(confirmed.body.invoice?.status, 'paid');
            strict_1.default.equal(confirmed.body.billing?.subscription, 'active');
            strict_1.default.equal(confirmed.body.adapter, 'local');
            const missing = await json(url, '/control/v1/billing/stripe/confirm', {
                method: 'POST',
                headers: auth,
                body: JSON.stringify({ sessionId: 'cs_local_missing' }),
            });
            strict_1.default.equal(missing.status, 404);
            strict_1.default.equal(missing.body.code, 'STRIPE_SESSION_MISSING');
        });
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
(0, node_test_1.default)('HTTP: Control Plane webhook returns the signing secret once', async () => {
    await withServer(async (url) => {
        const login = await json(url, '/control/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'superadmin@invexa.local', password: control_plane_js_1.controlPlane.seedPassword }),
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
        strict_1.default.equal(created.status, 201);
        strict_1.default.match(String(created.body.webhook?.signingSecret ?? ''), /^[a-f0-9]{64}$/);
        strict_1.default.equal(created.body.webhook?.url, 'https://hooks.example.com/grocery');
        const listed = await json(url, '/control/v1/integrations', { method: 'GET', headers: auth });
        strict_1.default.equal(listed.status, 200);
        const hook = listed.body.webhooks.find((entry) => entry.id === created.body.webhook.id);
        strict_1.default.ok(hook);
        strict_1.default.equal('signingSecret' in (hook ?? {}), false);
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
        strict_1.default.equal(denied.status, 403);
        strict_1.default.equal(denied.body.code, 'FEATURE_NOT_ENTITLED');
    });
});
