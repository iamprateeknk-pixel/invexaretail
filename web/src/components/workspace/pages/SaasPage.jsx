import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building } from 'lucide-react';

export function SaasPage() {
  const { saasPlans, saasTenants, saasForm, setSaasForm, onboardTenant, submitLoading } = useWorkspace();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {(saasPlans.length ? saasPlans : []).map((plan) => (
          <Card key={plan.code} className={saasForm.planCode === plan.code ? 'border-primary' : ''}>
            <CardHeader>
              <CardTitle className="text-base">{plan.name}</CardTitle>
              <p className="text-xs text-muted-foreground">{plan.description}</p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{plan.maxUsers} users · {plan.maxLocations} locations</p>
              <p className="text-xs text-muted-foreground">{(plan.modules ?? []).join(' · ')}</p>
              <Button size="sm" variant="outline" onClick={() => setSaasForm({ ...saasForm, planCode: plan.code })}>Select</Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onboard a tenant</CardTitle>
          <p className="text-xs text-muted-foreground">Creates a trial subscription, company record and admin login against the selected plan entitlements.</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input placeholder="Company name" value={saasForm.companyName} onChange={(event) => setSaasForm({ ...saasForm, companyName: event.target.value })} />
          <Input placeholder="Admin name" value={saasForm.adminName} onChange={(event) => setSaasForm({ ...saasForm, adminName: event.target.value })} />
          <Input placeholder="Admin email" value={saasForm.adminEmail} onChange={(event) => setSaasForm({ ...saasForm, adminEmail: event.target.value })} />
          <Select value={saasForm.planCode} onValueChange={(planCode) => setSaasForm({ ...saasForm, planCode })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{saasPlans.map((plan) => <SelectItem key={plan.code} value={plan.code}>{plan.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="password" placeholder="Temp password" value={saasForm.password} onChange={(event) => setSaasForm({ ...saasForm, password: event.target.value })} />
          <Button disabled={submitLoading || !saasForm.companyName.trim() || !saasForm.adminEmail.trim()} onClick={onboardTenant}>
            <Building className="size-4" />Provision tenant
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Tenants</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {saasTenants.length ? saasTenants.map((tenant) => (
            <div key={tenant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{tenant.name}</p>
                <p className="text-xs text-muted-foreground">{tenant.adminEmail} · {tenant.slug} · {formatDateTime(tenant.createdAt)}</p>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline">{tenant.planCode}</Badge>
                <Badge variant={tenant.status === 'ACTIVE' ? 'success' : 'warning'}>{tenant.status}</Badge>
              </div>
            </div>
          )) : <p className="py-10 text-center text-sm text-muted-foreground">No additional tenants yet. The default Invexa company stays on Enterprise.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
