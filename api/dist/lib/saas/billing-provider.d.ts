import { controlPlane, type ScopeContext } from './control-plane.js';
export declare const LOCAL_STRIPE_SECRET = "sk_test_invexa_local";
export declare const LOCAL_STRIPE_WEBHOOK_SECRET = "whsec_invexa_local";
export type BillingProviderName = 'manual' | 'stripe';
export type StripeAdapter = 'manual' | 'stripe' | 'local';
export type StripeTransport = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
}) => Promise<{
    status: number;
    json: () => Promise<Record<string, unknown>>;
}>;
export declare function stripeAdapter(): StripeAdapter;
export declare function resetLocalStripeSessions(): void;
export declare function billingProviderName(): BillingProviderName;
export declare function setStripeTransport(next: StripeTransport): void;
export declare function resetStripeTransport(): void;
export declare function verifyStripeSignature(secret: string, payload: string, header: string): boolean;
export declare function signStripePayload(secret: string, payload: string, timestamp?: number): string;
export declare function confirmLocalStripeCheckout(scope: ScopeContext, sessionId: string): {
    invoiceId: string;
    invoice: ReturnType<typeof controlPlane.payInvoice>;
};
export declare function createBillingCheckout(scope: ScopeContext, companyId: string, urls?: {
    successUrl?: string;
    cancelUrl?: string;
}): Promise<{
    companyId: string;
    planId: string;
    billing: {
        subscription: "trial" | "active" | "past_due";
        cycle: string;
        amount: number;
        stripeCustomerId?: string;
    };
    usage: Record<string, number>;
    limits: Record<string, number>;
    invoices: import("./control-plane.js").BillingInvoice[];
    provider: BillingProviderName;
    adapter: StripeAdapter;
    mode: "manual";
    invoice: import("./control-plane.js").BillingInvoice;
} | {
    companyId: string;
    planId: string;
    billing: {
        subscription: "trial" | "active" | "past_due";
        cycle: string;
        amount: number;
        stripeCustomerId?: string;
    };
    usage: Record<string, number>;
    limits: Record<string, number>;
    invoices: import("./control-plane.js").BillingInvoice[];
    provider: "stripe";
    adapter: "local" | "stripe";
    mode: "checkout";
    url: string;
    sessionId: string;
    invoice: import("./control-plane.js").BillingInvoice;
}>;
export declare function applyStripeCheckoutEvent(payload: Record<string, unknown>): {
    invoiceId: string;
    invoice: ReturnType<typeof controlPlane.payInvoice>;
};
