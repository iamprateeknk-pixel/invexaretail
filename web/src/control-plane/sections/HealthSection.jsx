import {
  LayoutDashboard,
} from 'lucide-react';
import { controlRequest } from '../control-api';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function HealthSection(props) {
  const { setError, companies, health, setHealth, auditEvents, controlToken, company, refreshLocked } = props;
  return (
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
  );
}
