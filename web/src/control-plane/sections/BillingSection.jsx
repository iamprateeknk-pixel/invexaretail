import { controlRequest } from '../control-api';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function BillingSection(props) {
  const { setError, users, billing, setBilling, controlToken, refreshLocked } = props;
  return (
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
  );
}
