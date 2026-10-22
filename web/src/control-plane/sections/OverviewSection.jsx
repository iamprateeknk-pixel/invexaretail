import {
  PauseCircle,
} from 'lucide-react';
import { controlRequest } from '../control-api';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function OverviewSection(props) {
  const { session, error, setError, loading, companies, setCompanies, users, runtime, billing, integrations, nextPlanId, setNextPlanId, platformToken, controlToken, company, persist, refreshLocked } = props;
  return (
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
  );
}
