import { useMemo } from 'react';
import { useControlSession } from './use-control-session';
import { OverviewSection } from './sections/OverviewSection';
import { StudioSection } from './sections/StudioSection';
import { UsersSection } from './sections/UsersSection';
import { WorkflowSection } from './sections/WorkflowSection';
import { MobileSection } from './sections/MobileSection';
import {
  Activity,
  ArrowLeft,
  Building2,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toaster } from '@/components/ui/sonner';
import { WEBHOOK_EVENT_OPTIONS } from '../lib/webhook-events';
import { clearControlSession, controlRequest } from './control-api';
import { isControlPlaneDeployment } from './control-route';
import { ModeSwitch, StudioModeProvider } from './studio-mode';


const NAV = [
  { id: 'overview', label: 'Company', icon: Building2 },
  { id: 'studio', label: 'Studio', icon: SlidersHorizontal },
  { id: 'users', label: 'Users', icon: Shield },
  { id: 'workflow', label: 'Approvals', icon: Workflow },
  { id: 'mobile', label: 'Mobile & sync', icon: Smartphone },
  { id: 'integrations', label: 'Integrations', icon: KeyRound },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'health', label: 'Health', icon: Activity },
];

export function ControlPlaneApp() {
  return (
    <StudioModeProvider>
      <ControlPlaneWorkspace />
    </StudioModeProvider>
  );
}

function ControlPlaneWorkspace() {
  const cp = useControlSession();
  const {
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
  } = cp;

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
            <p className="text-sm text-muted-foreground">Make changes, save them to the draft, then publish to make them live. Simple shows plain choices; Advanced also shows technical keys.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ModeSwitch />
            {lockBadge}
          </div>
        </div>
        {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

        {section === 'overview' && <OverviewSection {...cp} />}

        {section === 'studio' && <StudioSection {...cp} />}

        {section === 'users' && <UsersSection {...cp} />}

        {section === 'workflow' && <WorkflowSection {...cp} />}

        {section === 'mobile' && <MobileSection {...cp} />}

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
