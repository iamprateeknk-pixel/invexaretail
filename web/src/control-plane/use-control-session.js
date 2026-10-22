import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { exchangeSessionHandoff, handoffCodeFromHash, controlRequest, readControlSession, writeControlSession } from './control-api';

function stripeSessionFromLocation() {
  const hash = String(globalThis.location?.hash ?? '');
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : String(globalThis.location?.search ?? '').replace(/^\?/, '');
  return new URLSearchParams(query).get('stripeSession') ?? '';
}

function clearStripeSessionFromLocation() {
  const hash = String(globalThis.location?.hash ?? '');
  if (!hash.includes('stripeSession=')) return;
  const nextHash = hash.split('?')[0];
  globalThis.history?.replaceState?.(null, '', `${globalThis.location.pathname}${globalThis.location.search}${nextHash}`);
}

/**
 * All Control Plane session state and side effects: platform login, the company
 * picker session, the hard-locked company session and everything it loads
 * (draft, users, runtime, billing, integrations, health, audit), plus the
 * handoff exchange and the Stripe return confirmation. Extracted from
 * ControlPlaneApp (Phase 4); the workspace shell and sections consume the
 * single object this returns.
 */
export function useControlSession() {
  const [session, setSession] = useState(() => readControlSession());
  const [exchanging, setExchanging] = useState(() => Boolean(handoffCodeFromHash()));
  useEffect(() => {
    if (!exchanging) return;
    let cancelled = false;
    exchangeSessionHandoff().then((next) => {
      if (cancelled) return;
      if (next) { setSession(next); setCompanies(next.companies ?? []); }
      setExchanging(false);
    });
    return () => { cancelled = true; };
  }, [exchanging]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState(session?.companies ?? []);
  const [section, setSection] = useState('overview');
  const [draft, setDraft] = useState(null);
  const [users, setUsers] = useState([]);
  const [runtime, setRuntime] = useState(null);
  const [health, setHealth] = useState(null);
  const [billing, setBilling] = useState(null);
  const [integrations, setIntegrations] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('STORE_USER');
  const [previewRole, setPreviewRole] = useState('ADMIN');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyPlan, setNewCompanyPlan] = useState('starter');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [createdTenant, setCreatedTenant] = useState(null);
  const [auditEvents, setAuditEvents] = useState([]);
  const [nextPlanId, setNextPlanId] = useState(session?.company?.planId ?? 'pro');
  const [createdApiKey, setCreatedApiKey] = useState(null);
  const [webhookUrl, setWebhookUrl] = useState('https://example.com/invexa-hooks');
  const [webhookEvents, setWebhookEvents] = useState(['stock.low']);
  const [createdWebhook, setCreatedWebhook] = useState(null);

  const platformToken = session?.platformToken;
  const controlToken = session?.controlToken;
  const company = session?.company;

  function persist(next) {
    writeControlSession(next);
    setSession(next);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const login = await controlRequest('/control/v1/auth/login', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password },
      });
      persist({
        platformToken: login.token,
        user: login.user,
        companies: login.companies,
      });
      setCompanies(login.companies);
      setPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function selectCompany(companyId) {
    setLoading(true);
    setError('');
    try {
      const selected = await controlRequest('/control/v1/sessions/select-company', {
        token: platformToken,
        method: 'POST',
        body: { companyId },
      });
      persist({
        ...session,
        controlToken: selected.token,
        company: selected.company,
        controlSession: selected.session,
      });
      setSection('overview');
      setNextPlanId(selected.company.planId);
      toast.success(`Locked to ${selected.company.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Company lock failed');
    } finally {
      setLoading(false);
    }
  }

  async function exitCompany() {
    try {
      if (controlToken) {
        await controlRequest('/control/v1/sessions/exit', { token: controlToken, method: 'POST' });
      }
    } catch {
      // Local unlock must succeed even if the session was already closed.
    }
    persist({
      platformToken,
      user: session.user,
      companies,
    });
    toast.message('Company session closed. Re-select to continue.');
  }

  async function refreshLocked() {
    if (!controlToken) return;
    const [draftResult, usersResult, runtimeResult, billingResult, integrationsResult, healthResult, auditResult] = await Promise.allSettled([
      controlRequest('/studio/v1/draft', { token: controlToken }),
      controlRequest('/control/v1/users', { token: controlToken }),
      controlRequest('/studio/v1/runtime', { token: controlToken }),
      controlRequest('/control/v1/billing', { token: controlToken }),
      controlRequest('/control/v1/integrations', { token: controlToken }),
      controlRequest('/control/v1/health'),
      controlRequest('/control/v1/audit', { token: controlToken }),
    ]);
    if (draftResult.status === 'fulfilled') setDraft(draftResult.value.draft);
    if (usersResult.status === 'fulfilled') setUsers(usersResult.value.users);
    if (runtimeResult.status === 'fulfilled') setRuntime(runtimeResult.value.runtime);
    if (billingResult.status === 'fulfilled') setBilling(billingResult.value);
    if (integrationsResult.status === 'fulfilled') setIntegrations(integrationsResult.value);
    if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
    if (auditResult.status === 'fulfilled') setAuditEvents(Array.isArray(auditResult.value.events) ? auditResult.value.events : []);
    const firstFailure = [draftResult, usersResult, runtimeResult, billingResult, integrationsResult, healthResult]
      .find((result) => result.status === 'rejected');
    if (firstFailure) {
      throw firstFailure.reason;
    }
  }

  // The company list used to be whatever the LOGIN response carried, saved in the session and never asked
  // for again: a platform session that was already signed in kept showing a stale list (a company registered
  // since then never appeared) until the operator signed out and in. Ask the server whenever the company
  // picker is what is on screen.
  useEffect(() => {
    if (!platformToken || controlToken) return undefined;
    let cancelled = false;
    controlRequest('/control/v1/companies', { token: platformToken })
      .then((result) => {
        if (cancelled || !Array.isArray(result?.companies)) return;
        setCompanies(result.companies);
        const current = readControlSession();
        if (current?.platformToken) writeControlSession({ ...current, companies: result.companies });
      })
      .catch(() => {
        // Keep the list we already have; the picker still works with what login returned.
      });
    return () => { cancelled = true; };
  }, [platformToken, controlToken]);

  useEffect(() => {
    if (!controlToken) return;
    refreshLocked().catch((caught) => setError(caught.message));
  }, [controlToken]);

  useEffect(() => {
    if (!controlToken) return;
    let cancelled = false;
    async function confirmStripeFromHash() {
      const sessionId = stripeSessionFromLocation();
      if (!sessionId) return;
      try {
        const confirmed = await controlRequest('/control/v1/billing/stripe/confirm', {
          token: controlToken,
          method: 'POST',
          body: { sessionId },
        });
        if (cancelled) return;
        setBilling(confirmed);
        setSection('billing');
        setError('');
        toast.success('Stripe payment confirmed');
        clearStripeSessionFromLocation();
        await refreshLocked().catch((caught) => {
          if (!cancelled) setError(caught.message);
        });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Stripe confirm failed');
      }
    }
    confirmStripeFromHash();
    globalThis.addEventListener?.('hashchange', confirmStripeFromHash);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.('hashchange', confirmStripeFromHash);
    };
  }, [controlToken]);

  useEffect(() => {
    if (!controlToken || section !== 'integrations') return;
    controlRequest('/control/v1/integrations', { token: controlToken })
      .then(setIntegrations)
      .catch((caught) => setError(caught.message));
  }, [section, controlToken]);

  useEffect(() => {
    controlRequest('/control/v1/health')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [company?.id]);
  return {
    session,
    setSession,
    exchanging,
    email,
    setEmail,
    password,
    setPassword,
    error,
    setError,
    loading,
    setLoading,
    companies,
    setCompanies,
    section,
    setSection,
    draft,
    setDraft,
    users,
    setUsers,
    runtime,
    setRuntime,
    health,
    setHealth,
    billing,
    setBilling,
    integrations,
    setIntegrations,
    userEmail,
    setUserEmail,
    userName,
    setUserName,
    userRole,
    setUserRole,
    previewRole,
    setPreviewRole,
    newCompanyName,
    setNewCompanyName,
    newCompanyPlan,
    setNewCompanyPlan,
    newAdminName,
    setNewAdminName,
    newAdminEmail,
    setNewAdminEmail,
    createdTenant,
    setCreatedTenant,
    auditEvents,
    setAuditEvents,
    nextPlanId,
    setNextPlanId,
    createdApiKey,
    setCreatedApiKey,
    webhookUrl,
    setWebhookUrl,
    webhookEvents,
    setWebhookEvents,
    createdWebhook,
    setCreatedWebhook,
    platformToken,
    controlToken,
    company,
    persist,
    handleLogin,
    selectCompany,
    exitCompany,
    refreshLocked,
  };
}
