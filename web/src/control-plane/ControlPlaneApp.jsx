import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  PauseCircle,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Toaster } from '@/components/ui/sonner';
import { WEBHOOK_EVENT_OPTIONS } from '../lib/webhook-events';
import { clearControlSession, exchangeSessionHandoff, handoffCodeFromHash, controlRequest, readControlSession, writeControlSession } from './control-api';
import { isControlPlaneDeployment } from './control-route';
import { ImportColumnsEditor } from './ImportColumnsEditor';
import { StockColumnsLayoutEditor } from './StockColumnsLayoutEditor';

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

const NAV = [
  { id: 'overview', label: 'Company', icon: Building2 },
  { id: 'studio', label: 'Studio', icon: SlidersHorizontal },
  { id: 'users', label: 'Users', icon: Shield },
  { id: 'workflow', label: 'Workflows', icon: Workflow },
  { id: 'mobile', label: 'Mobile & sync', icon: Smartphone },
  { id: 'integrations', label: 'Integrations', icon: KeyRound },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'health', label: 'Health', icon: Activity },
];

export function ControlPlaneApp() {
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
  const [email, setEmail] = useState('superadmin@invexa.local');
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
  const [columnName, setColumnName] = useState('Minimum Stock');
  const [columnKey, setColumnKey] = useState('minimum_stock');
  const [ruleKey, setRuleKey] = useState('expiry_task');
  const [ruleName, setRuleName] = useState('Near-expiry task');
  const [ruleField, setRuleField] = useState('daysToExpiry');
  const [ruleComparator, setRuleComparator] = useState('Lt');
  const [ruleValue, setRuleValue] = useState('30');
  const [ruleAction, setRuleAction] = useState('CREATE_TASK:EXPIRY_ACTION');
  const [ruleTestContext, setRuleTestContext] = useState('{\n  "daysToExpiry": 10\n}');
  const [ruleTestResult, setRuleTestResult] = useState(null);
  const [reportKey, setReportKey] = useState('low_stock');
  const [reportName, setReportName] = useState('Low stock');
  const [reportEntity, setReportEntity] = useState('inventory');
  const [reportColumns, setReportColumns] = useState('item_code, available');
  const [automationKey, setAutomationKey] = useState('low_stock_notify');
  const [automationName, setAutomationName] = useState('Low stock notify');
  const [automationTrigger, setAutomationTrigger] = useState('event');
  const [automationExpression, setAutomationExpression] = useState('inventory.low_stock');
  const [automationActionKey, setAutomationActionKey] = useState('SEND_NOTIFICATION');
  const [mobilePolicyRole, setMobilePolicyRole] = useState('STORE_USER');
  const [mobilePolicyOfflineHours, setMobilePolicyOfflineHours] = useState('12');
  const [mobilePolicySyncScope, setMobilePolicySyncScope] = useState('stock, counts');
  const [mobilePolicyNavigation, setMobilePolicyNavigation] = useState('dashboard, stock, counts');
  const [fieldEntityType, setFieldEntityType] = useState('transfer');
  const [fieldKey, setFieldKey] = useState('');
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [fieldRequired, setFieldRequired] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('STORE_USER');
  const [previewRole, setPreviewRole] = useState('ADMIN');
  const [workflowValue, setWorkflowValue] = useState('150000');
  const [simulation, setSimulation] = useState(null);
  const [simulateKey, setSimulateKey] = useState('transfer.approval');
  const [newWorkflowKey, setNewWorkflowKey] = useState('');
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowThreshold, setNewWorkflowThreshold] = useState('100000');
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

  const lockBadge = useMemo(() => (
    company ? (
      <Badge variant="secondary" className="gap-1">
        <Lock className="size-3" />
        {company.name}
      </Badge>
    ) : <Badge variant="outline">No company locked</Badge>
  ), [company]);

  if (exchanging) {
    return <div role="status" className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Opening the Control Plane…</div>;
  }

  if (!platformToken) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
        <Toaster richColors position="top-right" />
        <Card className="w-full max-w-md">
          <CardHeader className="gap-2">
            <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Invexa Platform</p>
            <CardTitle>Control Plane</CardTitle>
            <p className="text-sm text-muted-foreground">Super Admin login. Company configuration requires a hard-locked session.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="control-email">Email</Label>
                <Input id="control-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="control-password">Password</Label>
                <Input id="control-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              </div>
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</Button>
              {!isControlPlaneDeployment() && (
                <Button type="button" variant="ghost" onClick={() => { window.location.hash = '#/dashboard'; }}>Back to workspace</Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!controlToken) {
    return (
      <div className="min-h-svh bg-muted/30 p-6">
        <Toaster richColors position="top-right" />
        <div className="mx-auto grid max-w-4xl gap-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Platform Super Admin</p>
              <h1 className="text-2xl font-semibold">Select one company</h1>
              <p className="text-sm text-muted-foreground">Switching later requires exit and a new locked session.</p>
            </div>
            <Button variant="outline" onClick={() => { clearControlSession(); setSession(null); }}>
              <LogOut className="size-4" />Sign out
            </Button>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {createdTenant && (
            <Alert variant="success">
              <AlertDescription>
                {createdTenant.companyName} is ready. Admin {createdTenant.email} signs in with one-time password {createdTenant.temporaryPassword}.
              </AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create company</CardTitle>
              <p className="text-sm text-muted-foreground">Provisions an operational admin, a default store, and a one-time password. Does not rewrite inventory.</p>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="new-company-name">Company name</Label>
                <Input id="new-company-name" autoComplete="off" value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} placeholder="Kota Fresh Mart" />
              </div>
              <div className="grid gap-2">
                <Label>Plan</Label>
                <Select value={newCompanyPlan} onValueChange={setNewCompanyPlan}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['starter', 'pro', 'enterprise'].map((planId) => (
                      <SelectItem key={planId} value={planId}>{planId}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-admin-name">Admin name</Label>
                <Input id="new-admin-name" autoComplete="off" value={newAdminName} onChange={(event) => setNewAdminName(event.target.value)} placeholder="Kota Admin" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-admin-email">Admin email</Label>
                <Input id="new-admin-email" type="email" autoComplete="off" value={newAdminEmail} onChange={(event) => setNewAdminEmail(event.target.value)} placeholder="admin@kota.local" />
              </div>
              <div className="md:col-span-2">
                <Button disabled={loading} onClick={async () => {
                  setLoading(true);
                  setError('');
                  try {
                    const created = await controlRequest('/control/v1/companies', {
                      token: platformToken,
                      method: 'POST',
                      body: {
                        name: newCompanyName,
                        planId: newCompanyPlan,
                        adminName: newAdminName || 'Company Admin',
                        adminEmail: newAdminEmail,
                      },
                    });
                    const nextCompanies = [...companies, created.company];
                    setCompanies(nextCompanies);
                    persist({ ...session, companies: nextCompanies });
                    setCreatedTenant({
                      companyName: created.company.name,
                      email: created.admin.email,
                      temporaryPassword: created.admin.temporaryPassword,
                    });
                    setNewCompanyName('');
                    setNewAdminName('');
                    setNewAdminEmail('');
                    toast.success(`${created.company.name} created`);
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : 'Create company failed');
                  } finally {
                    setLoading(false);
                  }
                }}>Create company</Button>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {companies.map((entry) => (
              <Card key={entry.id}>
                <CardHeader>
                  <CardTitle className="text-base">{entry.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{entry.id} · {entry.planId} · {entry.status}</p>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {entry.status === 'active' ? (
                    <Button onClick={() => selectCompany(entry.id)} disabled={loading}>
                      Lock session
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={loading} onClick={async () => {
                      setLoading(true);
                      setError('');
                      try {
                        const result = await controlRequest(`/control/v1/companies/${entry.id}/activate`, {
                          token: platformToken,
                          method: 'POST',
                          body: { reason: 'operator-activate' },
                        });
                        const nextCompanies = companies.map((row) => (
                          row.id === entry.id ? { ...row, ...result.company, status: 'active' } : row
                        ));
                        setCompanies(nextCompanies);
                        persist({ ...session, companies: nextCompanies });
                        toast.success(`${result.company.name} activated`);
                      } catch (caught) {
                        setError(caught instanceof Error ? caught.message : 'Activate failed');
                      } finally {
                        setLoading(false);
                      }
                    }}>Activate</Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh bg-muted/30">
      <Toaster richColors position="top-right" />
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:flex md:flex-col">
        <div className="border-b px-4 py-4">
          <p className="text-[10px] font-bold tracking-[0.18em] text-muted-foreground uppercase">Control Plane</p>
          <p className="mt-1 text-sm font-semibold">{session.user?.name}</p>
          <div className="mt-2">{lockBadge}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="grid gap-2 border-t p-3">
          <Button variant="outline" onClick={exitCompany}><ArrowLeft className="size-4" />Exit company</Button>
          <Button variant="ghost" onClick={() => { clearControlSession(); setSession(null); }}><LogOut className="size-4" />Sign out</Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{NAV.find((item) => item.id === section)?.label}</h1>
            <p className="text-sm text-muted-foreground">Draft → preview → publish. Core inventory invariants stay server-enforced.</p>
          </div>
          {lockBadge}
        </div>
        {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

        {section === 'overview' && (
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-sm">Plan</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-2xl font-semibold capitalize">{company.planId}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <Select value={nextPlanId} onValueChange={setNextPlanId}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['starter', 'pro', 'enterprise'].map((planId) => (
                        <SelectItem key={planId} value={planId}>{planId}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button disabled={loading || nextPlanId === company.planId} onClick={async () => {
                    try {
                      const result = await controlRequest(`/control/v1/companies/${company.id}/plan`, {
                        token: platformToken,
                        method: 'PUT',
                        body: { planId: nextPlanId, reason: 'operator-plan-change' },
                      });
                      const nextCompany = { ...company, ...result.company };
                      const nextCompanies = companies.map((entry) => (
                        entry.id === company.id ? { ...entry, ...result.company } : entry
                      ));
                      setCompanies(nextCompanies);
                      persist({ ...session, company: nextCompany, companies: nextCompanies });
                      toast.success(`Plan set to ${result.company.planId}`);
                      await refreshLocked().catch((caught) => setError(caught.message));
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : 'Plan change failed');
                    }
                  }}>Change plan</Button>
                </div>
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="text-sm">Users</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{billing?.usage?.users ?? users.length}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Config version</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{runtime?.version ?? '—'}</CardContent></Card>
            <Card className="md:col-span-3">
              <CardHeader><CardTitle className="text-base">Entitlements</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {Object.entries(company.entitlements ?? runtime?.modules ?? {}).map(([key, enabled]) => (
                  <Badge key={key} variant={enabled ? 'success' : 'secondary'}>{key}: {enabled ? 'on' : 'off'}</Badge>
                ))}
              </CardContent>
            </Card>
            <Card className="md:col-span-3">
              <CardHeader><CardTitle className="text-base">Tenant access</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={company.status === 'active' ? 'success' : 'destructive'}>{company.status}</Badge>
                  <span className="text-muted-foreground">
                    Items {billing?.usage?.items ?? '—'} / {billing?.limits?.max_items ?? '—'} · Locations {billing?.limits?.max_branches ?? '—'} · Users {billing?.usage?.users ?? users.length} / {billing?.limits?.max_users ?? '—'} · API {billing?.usage?.api_requests ?? 0} / {billing?.limits?.api_requests_per_day ?? '—'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Suspend freezes tenant login and operational APIs until Super Admin activates the company. Plan limits block new items, locations, and users. Starter hides OMS, analytics, and integrations until the plan is raised.
                </p>
                <Button variant="destructive" className="w-fit" onClick={async () => {
                  try {
                    await controlRequest(`/control/v1/companies/${company.id}/suspend`, {
                      token: controlToken,
                      method: 'POST',
                      body: { reason: 'operator-suspend' },
                    });
                    const nextCompanies = companies.map((entry) => (
                      entry.id === company.id ? { ...entry, status: 'suspended' } : entry
                    ));
                    setCompanies(nextCompanies);
                    try {
                      if (controlToken) {
                        await controlRequest('/control/v1/sessions/exit', { token: controlToken, method: 'POST' });
                      }
                    } catch {
                      // Suspend already closes the locked session.
                    }
                    persist({ platformToken, user: session.user, companies: nextCompanies });
                    toast.message('Company suspended — tenant login and API are frozen');
                  } catch (caught) {
                    const message = caught instanceof Error ? caught.message : 'Suspend failed';
                    setError(message);
                    toast.error(message);
                  }
                }}><PauseCircle className="size-4" />Suspend company</Button>
              </CardContent>
            </Card>
          </div>
        )}

        {section === 'studio' && (
          <Tabs defaultValue="columns">
            <TabsList>
              <TabsTrigger value="columns">Stock columns</TabsTrigger>
              <TabsTrigger value="import-columns">Import columns</TabsTrigger>
              <TabsTrigger value="fields">Fields</TabsTrigger>
              <TabsTrigger value="rules">Rules</TabsTrigger>
              <TabsTrigger value="reports">Reports</TabsTrigger>
              <TabsTrigger value="automations">Automations</TabsTrigger>
              <TabsTrigger value="mobile-policy">Mobile policy</TabsTrigger>
              <TabsTrigger value="preview">Preview / publish</TabsTrigger>
            </TabsList>
            <TabsContent value="import-columns" className="grid gap-4">
              <ImportColumnsEditor controlToken={controlToken} />
            </TabsContent>
            <TabsContent value="columns" className="grid gap-4">
              <StockColumnsLayoutEditor controlToken={controlToken} onSaved={refreshLocked} />
              <Card>
                <CardHeader><CardTitle className="text-base">Add custom stock column</CardTitle></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-4">
                  <div className="grid gap-2"><Label>Name</Label><Input value={columnName} onChange={(event) => setColumnName(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Key</Label><Input value={columnKey} onChange={(event) => setColumnKey(event.target.value)} /></div>
                  <div className="flex items-end"><Button onClick={async () => {
                    await controlRequest('/studio/v1/draft/stock/columns', { token: controlToken, method: 'POST', body: { name: columnName, key: columnKey, type: 'number' } });
                    await refreshLocked();
                    toast.success('Saved to draft');
                  }}>Save draft</Button></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-base">Draft columns</CardTitle>
                  <Button variant="outline" onClick={async () => {
                    await controlRequest('/studio/v1/draft/actions/export', { token: controlToken, method: 'POST', body: { enabled: false } });
                    await refreshLocked();
                    toast.message('Export disabled in draft');
                  }}>Disable export</Button>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Label</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(draft?.page?.columns ?? []).map((column) => (
                        <TableRow key={column.key}><TableCell>{column.key}</TableCell><TableCell>{column.label}</TableCell><TableCell>{column.source}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="fields" className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add field</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Works across entity types (transfer, order, item, ...), not just the stock page. Stock still
                    also gets a rendered column via "Stock columns" — this tab covers everything else.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-5">
                  <div className="grid gap-2"><Label>Entity type</Label><Input value={fieldEntityType} onChange={(event) => setFieldEntityType(event.target.value)} placeholder="transfer" /></div>
                  <div className="grid gap-2"><Label>Key</Label><Input value={fieldKey} onChange={(event) => setFieldKey(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Name</Label><Input value={fieldName} onChange={(event) => setFieldName(event.target.value)} /></div>
                  <div className="grid gap-2">
                    <Label>Type</Label>
                    <Select value={fieldType} onValueChange={setFieldType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['text', 'number', 'date', 'select', 'boolean'].map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Checkbox id="field-required" checked={fieldRequired} onCheckedChange={setFieldRequired} />
                    <Label htmlFor="field-required">Required</Label>
                  </div>
                  <div className="flex items-end md:col-span-5">
                    <Button onClick={async () => {
                      await controlRequest('/studio/v1/fields', {
                        token: controlToken,
                        method: 'POST',
                        body: { entityType: fieldEntityType, key: fieldKey, name: fieldName, type: fieldType, required: fieldRequired },
                      });
                      await refreshLocked();
                      toast.success('Field saved to draft');
                    }}>Save draft</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Draft fields</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Entity</TableHead><TableHead>Key</TableHead><TableHead>Label</TableHead><TableHead>Type</TableHead><TableHead>Required</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(draft?.fields ?? []).map((field) => (
                        <TableRow key={`${field.entityType}:${field.fieldKey}`}>
                          <TableCell>{field.entityType}</TableCell>
                          <TableCell>{field.fieldKey}</TableCell>
                          <TableCell>{field.label}</TableCell>
                          <TableCell>{field.dataType}</TableCell>
                          <TableCell>{field.required ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="rules" className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add rule</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    One condition per rule for now: a context field compared against a value. Save to draft, then
                    publish for it to take effect.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <div className="grid gap-2"><Label>Key</Label><Input value={ruleKey} onChange={(event) => setRuleKey(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Name</Label><Input value={ruleName} onChange={(event) => setRuleName(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Context field</Label><Input value={ruleField} onChange={(event) => setRuleField(event.target.value)} placeholder="daysToExpiry" /></div>
                  <div className="grid gap-2">
                    <Label>Comparator</Label>
                    <Select value={ruleComparator} onValueChange={setRuleComparator}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eq">equals</SelectItem>
                        <SelectItem value="Gt">greater than</SelectItem>
                        <SelectItem value="Gte">greater or equal</SelectItem>
                        <SelectItem value="Lt">less than</SelectItem>
                        <SelectItem value="Lte">less or equal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2"><Label>Value</Label><Input value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Outcome action</Label><Input value={ruleAction} onChange={(event) => setRuleAction(event.target.value)} /></div>
                  <div className="flex items-end md:col-span-3">
                    <Button onClick={async () => {
                      const conditionKey = ruleComparator === 'eq' ? ruleField : `${ruleField}${ruleComparator}`;
                      const value = ruleComparator === 'eq' ? ruleValue : Number(ruleValue);
                      await controlRequest('/studio/v1/rules', {
                        token: controlToken,
                        method: 'POST',
                        body: { key: ruleKey, name: ruleName, condition: { [conditionKey]: value }, outcome: { action: ruleAction } },
                      });
                      await refreshLocked();
                      toast.success('Rule saved to draft');
                    }}>Save draft</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Draft rules</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Name</TableHead><TableHead>Condition</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(draft?.rules ?? []).map((rule) => (
                        <TableRow key={rule.key}>
                          <TableCell>{rule.key}</TableCell>
                          <TableCell>{rule.name}</TableCell>
                          <TableCell className="font-mono text-xs">{JSON.stringify(rule.condition)}</TableCell>
                          <TableCell className="font-mono text-xs">{JSON.stringify(rule.outcome)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Test evaluate (published rules)</CardTitle></CardHeader>
                <CardContent className="grid gap-3">
                  <Textarea rows={4} className="font-mono text-xs" value={ruleTestContext} onChange={(event) => setRuleTestContext(event.target.value)} />
                  <div className="flex items-center gap-3">
                    <Button variant="outline" onClick={async () => {
                      let context;
                      try {
                        context = JSON.parse(ruleTestContext);
                      } catch {
                        toast.error('Context must be valid JSON');
                        return;
                      }
                      const result = await controlRequest('/studio/v1/rules/evaluate', { token: controlToken, method: 'POST', body: context });
                      setRuleTestResult(result.outcomes);
                    }}>Test evaluate</Button>
                    {ruleTestResult && (
                      <span className="text-sm text-muted-foreground">
                        {ruleTestResult.length ? `Outcomes: ${ruleTestResult.join(', ')}` : 'No rule matched.'}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="reports" className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add report</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Dataset + columns for now — filters, pivot and scheduling come later.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-4">
                  <div className="grid gap-2"><Label>Key</Label><Input value={reportKey} onChange={(event) => setReportKey(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Name</Label><Input value={reportName} onChange={(event) => setReportName(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Entity</Label><Input value={reportEntity} onChange={(event) => setReportEntity(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Columns (comma-separated)</Label><Input value={reportColumns} onChange={(event) => setReportColumns(event.target.value)} /></div>
                  <div className="flex items-end">
                    <Button onClick={async () => {
                      const columns = reportColumns.split(',').map((column) => column.trim()).filter(Boolean);
                      await controlRequest('/studio/v1/reports', {
                        token: controlToken,
                        method: 'POST',
                        body: { key: reportKey, name: reportName, entity: reportEntity, columns, filters: {} },
                      });
                      await refreshLocked();
                      toast.success('Report saved to draft');
                    }}>Save draft</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Draft reports</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Name</TableHead><TableHead>Entity</TableHead><TableHead>Columns</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(draft?.reports ?? []).map((report) => (
                        <TableRow key={report.key}>
                          <TableCell>{report.key}</TableCell>
                          <TableCell>{report.name}</TableCell>
                          <TableCell>{report.entity}</TableCell>
                          <TableCell className="font-mono text-xs">{report.columns.join(', ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="automations" className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add automation</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Trigger (schedule/event) + expression -&gt; one action key. The action itself still needs
                    backend wiring per key; this records the intent and makes it visible/editable in Studio.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-5">
                  <div className="grid gap-2"><Label>Key</Label><Input value={automationKey} onChange={(event) => setAutomationKey(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Name</Label><Input value={automationName} onChange={(event) => setAutomationName(event.target.value)} /></div>
                  <div className="grid gap-2">
                    <Label>Trigger</Label>
                    <Select value={automationTrigger} onValueChange={setAutomationTrigger}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="event">event</SelectItem>
                        <SelectItem value="schedule">schedule</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2"><Label>Expression</Label><Input value={automationExpression} onChange={(event) => setAutomationExpression(event.target.value)} placeholder="inventory.low_stock" /></div>
                  <div className="grid gap-2"><Label>Action key</Label><Input value={automationActionKey} onChange={(event) => setAutomationActionKey(event.target.value)} /></div>
                  <div className="flex items-end">
                    <Button onClick={async () => {
                      await controlRequest('/studio/v1/automations', {
                        token: controlToken,
                        method: 'POST',
                        body: { key: automationKey, name: automationName, trigger: automationTrigger, expression: automationExpression, actionKey: automationActionKey },
                      });
                      await refreshLocked();
                      toast.success('Automation saved to draft');
                    }}>Save draft</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Draft automations</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Name</TableHead><TableHead>Trigger</TableHead><TableHead>Expression</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(draft?.automations ?? []).map((automation) => (
                        <TableRow key={automation.key}>
                          <TableCell>{automation.key}</TableCell>
                          <TableCell>{automation.name}</TableCell>
                          <TableCell>{automation.trigger}</TableCell>
                          <TableCell className="font-mono text-xs">{automation.expression}</TableCell>
                          <TableCell className="font-mono text-xs">{automation.actionKey}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="mobile-policy" className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Set role mobile policy</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Offline max age, what syncs, and the navigation this role sees on the Flutter app. Local
                    storage is always encrypted.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-4">
                  <div className="grid gap-2">
                    <Label>Role</Label>
                    <Select value={mobilePolicyRole} onValueChange={setMobilePolicyRole}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['STORE_USER', 'WAREHOUSE_PICKER', 'BRANCH_MANAGER', 'AUDITOR', 'ADMIN'].map((role) => (
                          <SelectItem key={role} value={role}>{role}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2"><Label>Offline max hours</Label><Input type="number" value={mobilePolicyOfflineHours} onChange={(event) => setMobilePolicyOfflineHours(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Sync scope (comma-separated)</Label><Input value={mobilePolicySyncScope} onChange={(event) => setMobilePolicySyncScope(event.target.value)} /></div>
                  <div className="grid gap-2"><Label>Navigation (comma-separated)</Label><Input value={mobilePolicyNavigation} onChange={(event) => setMobilePolicyNavigation(event.target.value)} /></div>
                  <div className="flex items-end">
                    <Button onClick={async () => {
                      await controlRequest('/studio/v1/mobile-policy', {
                        token: controlToken,
                        method: 'POST',
                        body: {
                          role: mobilePolicyRole,
                          offlineMaxHours: Number(mobilePolicyOfflineHours),
                          syncScope: mobilePolicySyncScope.split(',').map((entry) => entry.trim()).filter(Boolean),
                          navigation: mobilePolicyNavigation.split(',').map((entry) => entry.trim()).filter(Boolean),
                        },
                      });
                      await refreshLocked();
                      toast.success('Mobile policy saved to draft');
                    }}>Save draft</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Draft mobile policies</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Offline max</TableHead><TableHead>Sync scope</TableHead><TableHead>Navigation</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(draft?.mobilePolicies ?? []).map((policy) => (
                        <TableRow key={policy.role}>
                          <TableCell>{policy.role}</TableCell>
                          <TableCell>{policy.offlineMaxHours}h</TableCell>
                          <TableCell className="font-mono text-xs">{policy.syncScope.join(', ')}</TableCell>
                          <TableCell className="font-mono text-xs">{policy.navigation.join(', ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="preview" className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <Select value={previewRole} onValueChange={setPreviewRole}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['ADMIN', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'].map((role) => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={async () => {
                  const preview = await controlRequest('/studio/v1/preview', { token: controlToken, method: 'POST', body: { role: previewRole, device: 'desktop' } });
                  toast.success(`Preview ${preview.preview.page.columns.length} columns as ${previewRole}`);
                }}>Preview as role</Button>
                <Button onClick={async () => {
                  try {
                    await controlRequest('/studio/v1/publish', { token: controlToken, method: 'POST' });
                    await refreshLocked().catch((caught) => setError(caught.message));
                    setError('');
                    toast.success('Published');
                  } catch (caught) {
                    const message = caught instanceof Error ? caught.message : 'Publish failed';
                    setError(message);
                    toast.error(message);
                  }
                }}>Publish</Button>
                <Button variant="outline" onClick={async () => {
                  await controlRequest('/studio/v1/rollback', { token: controlToken, method: 'POST', body: { version: 1 } });
                  await refreshLocked();
                  toast.message('Rolled back to version 1');
                }}>Rollback v1</Button>
              </div>
              <Card>
                <CardHeader><CardTitle className="text-base">Live runtime for this company</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Version {runtime?.version ?? '—'} · {(runtime?.page?.columns ?? []).map((column) => column.label).join(' · ')}
                  <p className="mt-2">Items & stock in the grocery workspace uses this published page: custom columns and enabled header actions.</p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {section === 'users' && (
          <Card>
            <CardHeader><CardTitle className="text-base">Company users</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-4">
                <Input placeholder="Name" value={userName} onChange={(event) => setUserName(event.target.value)} />
                <Input placeholder="Email" value={userEmail} onChange={(event) => setUserEmail(event.target.value)} />
                <Select value={userRole} onValueChange={setUserRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['STORE_USER', 'WAREHOUSE_PICKER', 'BRANCH_MANAGER', 'AUDITOR', 'ADMIN'].map((role) => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={async () => {
                  await controlRequest('/control/v1/users', { token: controlToken, method: 'POST', body: { name: userName, email: userEmail, role: userRole } });
                  setUserEmail('');
                  setUserName('');
                  await refreshLocked();
                  toast.success('User created');
                }}>Create user</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.role}{user.isPrimaryAdmin ? ' · primary' : ''}</TableCell>
                      <TableCell>{user.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {section === 'workflow' && (
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Create approval workflow</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Value at or under the threshold auto-approves; above it goes to a branch manager. Other
                  trigger/condition shapes need direct API use for now — this covers the common approval-limit
                  pattern.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4">
                <div className="grid gap-2"><Label>Key</Label><Input value={newWorkflowKey} onChange={(event) => setNewWorkflowKey(event.target.value)} placeholder="count.approval" /></div>
                <div className="grid gap-2"><Label>Name</Label><Input value={newWorkflowName} onChange={(event) => setNewWorkflowName(event.target.value)} /></div>
                <div className="grid gap-2"><Label>Auto-approve up to</Label><Input type="number" value={newWorkflowThreshold} onChange={(event) => setNewWorkflowThreshold(event.target.value)} /></div>
                <div className="flex items-end">
                  <Button onClick={async () => {
                    await controlRequest('/studio/v1/workflows', {
                      token: controlToken,
                      method: 'POST',
                      body: {
                        key: newWorkflowKey,
                        name: newWorkflowName,
                        version: 1,
                        graph: {
                          nodes: [
                            { id: 'start', type: 'trigger', config: { event: `${newWorkflowKey}.created` } },
                            { id: 'check', type: 'condition', config: { field: 'value', op: 'lte', amount: Number(newWorkflowThreshold) } },
                            { id: 'auto', type: 'action', config: { action: 'AUTO_APPROVE' } },
                            { id: 'manager', type: 'approval', config: { role: 'BRANCH_MANAGER' } },
                          ],
                        },
                      },
                    });
                    await refreshLocked();
                    toast.success('Workflow saved to draft');
                  }}>Save draft</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Draft workflows</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Name</TableHead><TableHead>Threshold</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(draft?.workflows ?? []).map((workflow) => (
                      <TableRow key={workflow.key}>
                        <TableCell>{workflow.key}</TableCell>
                        <TableCell>{workflow.name}</TableCell>
                        <TableCell>{workflow.graph.nodes.find((node) => node.type === 'condition')?.config.amount ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Simulate (published workflows)</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4">
                <Input value={simulateKey} onChange={(event) => setSimulateKey(event.target.value)} placeholder="transfer.approval" />
                <Input value={workflowValue} onChange={(event) => setWorkflowValue(event.target.value)} />
                <Button onClick={async () => {
                  try {
                    const result = await controlRequest('/studio/v1/workflows/simulate', { token: controlToken, method: 'POST', body: { key: simulateKey, value: Number(workflowValue) } });
                    setSimulation(result.simulation);
                  } catch (caught) {
                    toast.error(caught instanceof Error ? caught.message : 'Simulation failed');
                  }
                }}>Simulate</Button>
                <div className="text-sm text-muted-foreground">{simulation ? `${simulation.outcome} (workflow v${simulation.pinnedVersion})` : 'Run a value through a published workflow.'}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {section === 'mobile' && (
          <div className="grid gap-4">
            {(draft?.mobilePolicies ?? []).map((policy) => (
              <Card key={policy.role}>
                <CardHeader><CardTitle className="text-base">{policy.role}</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Encrypted local store · offline {policy.offlineMaxHours}h · nav {policy.navigation.join(', ')}
                </CardContent>
              </Card>
            ))}
            <Button variant="outline" onClick={async () => {
              const result = await controlRequest('/sync/v1/mutations', {
                token: controlToken,
                method: 'POST',
                body: { mutationId: crypto.randomUUID(), companyId: company.id, userId: session.user.id, deviceId: 'control-demo', actionType: 'STOCK_ADJUST', payload: { itemId: 'item-1', delta: -1 } },
              });
              toast.success(`Sync ${result.mutation.status}`);
            }}>Post sample stock movement</Button>
          </div>
        )}

        {section === 'integrations' && (
          <div className="grid gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">API keys & connectors</CardTitle>
              <Button onClick={async () => {
                const key = await controlRequest('/control/v1/integrations/api-keys', { token: controlToken, method: 'POST', body: { name: 'POS', scopes: ['inventory.read'] } });
                setCreatedApiKey(key);
                toast.success(`Key ${key.prefix}… shown once`);
                await refreshLocked();
              }}>Create API key</Button>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {createdApiKey?.token && (
                <Alert>
                  <AlertDescription className="grid gap-2">
                    <span>Copy this key now. Invexa will not show it again.</span>
                    <code className="break-all font-mono text-xs">{createdApiKey.token}</code>
                    <Button size="sm" variant="outline" className="w-fit" onClick={async () => {
                      try {
                        await globalThis.navigator?.clipboard?.writeText(createdApiKey.token);
                        toast.success('API key copied');
                      } catch {
                        toast.message('Copy the key from the box above');
                      }
                    }}>Copy key</Button>
                  </AlertDescription>
                </Alert>
              )}
              <p className="text-muted-foreground">
                Bearer invx_ keys authenticate `/api/v1`. Read keys list catalog; write scopes are required to mutate.
              </p>
              {(integrations?.apiKeys ?? []).map((key) => (
                <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="grid gap-1">
                    <span className="font-medium">{key.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{key.prefix}… · {(key.scopes ?? []).join(', ')} · {key.status}</span>
                  </div>
                  {key.status !== 'revoked' && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      await controlRequest(`/control/v1/integrations/api-keys/${key.id}/revoke`, { token: controlToken, method: 'POST' });
                      if (createdApiKey?.id === key.id) setCreatedApiKey(null);
                      toast.message('API key revoked');
                      await refreshLocked().catch((caught) => setError(caught.message));
                    }}>Revoke</Button>
                  )}
                </div>
              ))}
              <p className="text-muted-foreground">Connectors: {(integrations?.connectors ?? []).length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Operational webhooks</CardTitle>
              <Button onClick={async () => {
                try {
                  const created = await controlRequest('/control/v1/integrations/webhooks', {
                    token: controlToken,
                    method: 'POST',
                    body: { name: 'Ops hook', url: webhookUrl, events: webhookEvents },
                  });
                  const webhook = created.webhook ?? created;
                  setCreatedWebhook(webhook);
                  setIntegrations((current) => ({
                    ...(current ?? {}),
                    webhooks: [
                      ...(current?.webhooks ?? []).filter((hook) => hook.id !== webhook.id),
                      {
                        id: webhook.id,
                        name: webhook.name,
                        url: webhook.url,
                        events: webhook.events,
                        status: webhook.status || 'active',
                        createdAt: webhook.createdAt,
                      },
                    ],
                  }));
                  toast.success('Webhook registered');
                  await refreshLocked().catch((caught) => setError(caught.message));
                } catch (caught) {
                  setError(caught.message);
                  toast.error(caught.message);
                }
              }}>Create webhook</Button>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="grid gap-2">
                <Label>HTTPS endpoint</Label>
                <Input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENT_OPTIONS.map((option) => {
                  const active = webhookEvents.includes(option.value);
                  return (
                    <Button
                      key={option.value}
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      onClick={() => setWebhookEvents((current) => (
                        current.includes(option.value)
                          ? current.filter((event) => event !== option.value)
                          : [...current, option.value]
                      ))}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
              {createdWebhook?.signingSecret && (
                <Alert>
                  <AlertDescription className="grid gap-2">
                    <span>Copy this signing secret now. Invexa will not show it again.</span>
                    <code className="break-all font-mono text-xs">{createdWebhook.signingSecret}</code>
                    <Button size="sm" variant="outline" className="w-fit" onClick={async () => {
                      try {
                        await globalThis.navigator?.clipboard?.writeText(createdWebhook.signingSecret);
                        toast.success('Signing secret copied');
                      } catch {
                        toast.message('Copy the secret from the box above');
                      }
                    }}>Copy secret</Button>
                  </AlertDescription>
                </Alert>
              )}
              <p className="text-muted-foreground">
                Stock, transfer, PO and count events for this company POST to the HTTPS URL with X-Invexa-Signature.
              </p>
              <p className="font-medium">Registered webhooks ({(integrations?.webhooks ?? []).length})</p>
              {(integrations?.webhooks ?? []).length === 0 && (
                <p className="text-muted-foreground">No operational webhooks for this company yet.</p>
              )}
              {(integrations?.webhooks ?? []).map((hook) => (
                <div key={hook.id} className="rounded-lg border px-3 py-2">
                  <p className="font-medium">{hook.name || hook.url}</p>
                  <p className="font-mono text-xs text-muted-foreground">{hook.url} · {(hook.events ?? []).join(', ')} · {hook.status}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          </div>
        )}

        {section === 'billing' && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">Usage vs limits</CardTitle>
                <Badge variant="outline">{billing?.adapter ?? billing?.provider ?? 'manual'}</Badge>
                {billing?.adapter === 'stripe' && <Badge>Stripe live</Badge>}
                {billing?.adapter === 'local' && <Badge>Stripe local</Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={async () => {
                  const issued = await controlRequest('/control/v1/billing/invoices', { token: controlToken, method: 'POST' });
                  setBilling(issued);
                  toast.success('Invoice issued');
                  await refreshLocked().catch((caught) => setError(caught.message));
                }}>Issue invoice</Button>
                <Button onClick={async () => {
                  const checkout = await controlRequest('/control/v1/billing/checkout', {
                    token: controlToken,
                    method: 'POST',
                    body: {
                      successUrl: globalThis.location?.href,
                      cancelUrl: globalThis.location?.href,
                    },
                  });
                  setBilling(checkout);
                  if (checkout.mode === 'checkout' && checkout.url) {
                    if (checkout.adapter === 'local') {
                      const nextHash = String(checkout.url).split('#')[1];
                      if (nextHash) globalThis.location.hash = nextHash;
                      else globalThis.location.assign(checkout.url);
                      toast.success('Local Stripe checkout ready');
                    } else {
                      globalThis.open?.(checkout.url, '_blank', 'noopener');
                      toast.success('Stripe checkout opened');
                    }
                  } else {
                    toast.message('Manual billing — record payment when the transfer clears');
                  }
                  await refreshLocked().catch((caught) => setError(caught.message));
                }}>Collect payment</Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p>Subscription: {billing?.billing?.subscription}</p>
              <p>Users {billing?.usage?.users ?? 0} / {billing?.limits?.max_users ?? '—'}</p>
              <p>API requests {billing?.usage?.api_requests ?? 0} / {billing?.limits?.api_requests_per_day ?? '—'}</p>
              {(Array.isArray(billing?.invoices) ? billing.invoices : []).map((invoice) => (
                <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="grid gap-1">
                    <span className="font-mono text-xs">{String(invoice.id).slice(0, 8)}</span>
                    <span>Amount {invoice.amount} · <Badge variant={invoice.status === 'past_due' ? 'destructive' : 'secondary'}>{invoice.status}</Badge></span>
                  </div>
                  <div className="flex gap-2">
                    {invoice.status === 'open' && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        const updated = await controlRequest(`/control/v1/billing/invoices/${invoice.id}/past-due`, { token: controlToken, method: 'POST' });
                        setBilling(updated);
                        toast.message('Invoice marked past due — Studio publish is on hold');
                        await refreshLocked().catch((caught) => setError(caught.message));
                      }}>Mark past due</Button>
                    )}
                    {invoice.status !== 'paid' && (
                      <Button size="sm" variant="outline" onClick={async () => {
                        const updated = await controlRequest(`/control/v1/billing/invoices/${invoice.id}/pay`, { token: controlToken, method: 'POST' });
                        setBilling(updated);
                        setError('');
                        toast.success('Payment recorded');
                        await refreshLocked().catch((caught) => setError(caught.message));
                      }}>Record payment</Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {section === 'health' && (
          <Card>
            <CardHeader><CardTitle className="text-base">System health</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <LayoutDashboard className="size-4" />
                <span>{health?.ok ? 'Control plane healthy' : 'Unavailable'}</span>
                <Badge variant="secondary">{health?.companies ?? 0} companies</Badge>
                <Badge variant="outline">{health?.persistence ?? 'snapshot'}</Badge>
                {(health?.pastDueCompanies ?? []).length > 0 && (
                  <Badge variant="destructive">{health.pastDueCompanies.length} past due</Badge>
                )}
                {(health?.suspendedCompanies ?? []).length > 0 && (
                  <Badge variant="destructive">{health.suspendedCompanies.length} suspended</Badge>
                )}
              </div>
              <div className="grid gap-2">
                <p className="text-muted-foreground">Platform kill switches freeze mutations across every company. Reads stay available.</p>
                {['INVENTORY', 'WMS', 'OMS'].map((feature) => {
                  const enabled = health?.killSwitches?.[feature] !== false;
                  return (
                    <div key={feature} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                      <div>
                        <p className="font-medium">{feature}</p>
                        <p className="text-xs text-muted-foreground">{enabled ? 'Mutations allowed' : 'Mutations blocked'}</p>
                      </div>
                      <Button size="sm" variant={enabled ? 'destructive' : 'outline'} onClick={async () => {
                        const result = await controlRequest('/control/v1/safety/kill-switches', {
                          token: controlToken,
                          method: 'POST',
                          body: { featureKey: feature, enabled: !enabled, reason: enabled ? 'incident' : 'restore' },
                        });
                        setHealth((current) => ({ ...(current ?? { ok: true }), killSwitches: result.safety }));
                        toast.message(enabled ? `${feature} kill switch on` : `${feature} restored`);
                        await refreshLocked().catch((caught) => setError(caught.message));
                      }}>{enabled ? 'Kill' : 'Restore'}</Button>
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-2">
                <p className="text-muted-foreground">Recent control-plane audit events for this company.</p>
                {(Array.isArray(auditEvents) ? auditEvents.slice(-8).reverse() : []).map((event) => (
                  <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <span className="font-mono text-xs">{event.action}</span>
                    <span className="text-xs text-muted-foreground">{event.companyId ?? 'platform'}</span>
                  </div>
                ))}
                {(!Array.isArray(auditEvents) || auditEvents.length === 0) && (
                  <p className="text-xs text-muted-foreground">No audit events yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
