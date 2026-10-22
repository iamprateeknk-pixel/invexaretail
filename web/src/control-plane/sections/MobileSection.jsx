import { controlRequest } from '../control-api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Advanced } from '../studio-mode';
import { labelOf, MOBILE_SCREENS, ROLE_OPTIONS } from '../studio-catalog';

export function MobileSection(props) {
  const { session, draft, controlToken, company } = props;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">What each role gets in the phone app. Change it in Studio → Mobile app, then publish.</p>
      {(draft?.mobilePolicies ?? []).length === 0 && <p className="text-sm text-muted-foreground">No role has mobile settings yet.</p>}
      {(draft?.mobilePolicies ?? []).map((policy) => (
        <Card key={policy.role}>
          <CardHeader><CardTitle className="text-base">{labelOf(ROLE_OPTIONS, policy.role)}</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Screens: {policy.navigation.map((screen) => labelOf(MOBILE_SCREENS, screen)).join(', ') || '—'} · works offline up to {policy.offlineMaxHours} hours · phone data is encrypted
          </CardContent>
        </Card>
      ))}
      <Advanced label="Advanced: sync test">
        <div>
          <Button variant="outline" onClick={async () => {
            const result = await controlRequest('/sync/v1/mutations', {
              token: controlToken,
              method: 'POST',
              body: { mutationId: crypto.randomUUID(), companyId: company.id, userId: session.user.id, deviceId: 'control-demo', actionType: 'STOCK_ADJUST', payload: { itemId: 'item-1', delta: -1 } },
            });
            toast.success(`Sync ${result.mutation.status}`);
          }}>Post sample stock movement</Button>
        </div>
      </Advanced>
    </div>
  );
}
