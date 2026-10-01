import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ItemForecastPanel({ item, token, locationId, role, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canSeePolicy = ['ADMIN', 'ADMIN_USER'].includes(role);
  const [reviewPeriodDays, setReviewPeriodDays] = useState(7);
  const [policy, setPolicy] = useState(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const loadPolicy = () => {
    if (!locationId) return;
    setPolicyLoading(true); setPolicyError('');
    apiRequest(`/api/v1/items/${encodeURIComponent(item.id)}/periodic-review-policy?locationId=${encodeURIComponent(locationId)}&reviewPeriodDays=${encodeURIComponent(reviewPeriodDays)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => { if (mounted.current) setPolicy(response); })
      .catch((err) => { if (mounted.current) setPolicyError(err instanceof Error ? err.message : 'Unable to load the periodic-review policy.'); })
      .finally(() => { if (mounted.current) setPolicyLoading(false); });
  };

  useEffect(() => {
    if (!locationId) { setError('Select a location to view its forecast.'); setLoading(false); return; }
    setLoading(true); setError('');
    apiRequest(`/api/v1/items/${encodeURIComponent(item.id)}/forecast?locationId=${encodeURIComponent(locationId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => { if (mounted.current) setData(response); })
      .catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load forecast.'); })
      .finally(() => { if (mounted.current) setLoading(false); });
  }, [item.id, locationId, token]);

  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Demand forecast</DialogTitle><DialogDescription>{item.code} · {item.name}</DialogDescription></DialogHeader>
      {loading ? <p role="status">Loading forecast…</p> : error ? <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div> : data && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/25 p-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">On hand</p><p className="font-medium">{data.onHand}</p></div>
          <div><p className="text-xs text-muted-foreground">On order</p><p className="font-medium">{data.onOrder}</p></div>
          <div><p className="text-xs text-muted-foreground">Avg daily sales</p><p className="font-medium">{data.demand?.averageDailyDemand?.toFixed?.(2) ?? '—'}</p></div>
          <div><p className="text-xs text-muted-foreground">Days cover</p><p className="font-medium">{data.suggestion?.daysCover != null ? Math.round(data.suggestion.daysCover) : '—'}</p></div>
        </div>

        <div>
          <p className="mb-2 font-medium">Replenishment suggestion</p>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">Safety stock</p><p>{Math.round(data.suggestion?.safetyStock ?? 0)}</p></div>
            <div><p className="text-xs text-muted-foreground">Reorder point</p><p>{Math.round(data.suggestion?.reorderPoint ?? 0)}</p></div>
            <div><p className="text-xs text-muted-foreground">Suggested order qty</p><p className="font-semibold">{Math.round(data.suggestion?.suggestedOrderQty ?? 0)}</p></div>
          </div>
          {data.suggestion?.stockoutDate && (
            <p className="mt-2 text-xs text-muted-foreground">Projected stockout: {new Date(data.suggestion.stockoutDate).toLocaleDateString()}</p>
          )}
        </div>

        {data.expiryActions?.length > 0 && <div>
          <p className="mb-2 font-medium">Expiry risk</p>
          <ul className="grid gap-1.5">
            {data.expiryActions.map((row, index) => <li key={index} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span>{row.lotNo} · {row.onHand} units</span>
              <Badge variant={row.type === 'EXPIRY' ? 'destructive' : 'warning'}>{row.daysToExpiry < 0 ? 'Expired' : `${row.daysToExpiry}d left`}</Badge>
            </li>)}
          </ul>
        </div>}

        {data.overstock?.length > 0 && <div>
          <p className="mb-2 font-medium">Network transfer opportunity</p>
          <ul className="grid gap-1.5">
            {data.overstock.map((row, index) => <li key={index} className="rounded-md border p-2 text-sm">
              Transfer <strong>{row.suggestedTransferQty}</strong> to {row.destinationLocationName ?? row.destinationLocationId}
            </li>)}
          </ul>
        </div>}

        {!data.expiryActions?.length && !data.overstock?.length && (
          <p className="text-xs text-muted-foreground">No expiry risk or overstock signal for this item right now.</p>
        )}

        {canSeePolicy && <div className="border-t pt-4">
          <p className="mb-2 font-medium">Periodic-review (R,S) policy</p>
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="review-period-days" className="block text-xs text-muted-foreground">Review every (days)</label>
              <Input id="review-period-days" type="number" min="1" max="90" className="h-8 w-20" value={reviewPeriodDays} onChange={(e) => setReviewPeriodDays(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" disabled={policyLoading} onClick={loadPolicy}>{policyLoading ? 'Calculating…' : 'Calculate policy'}</Button>
          </div>
          {policyError && <p role="alert" className="mt-2 text-xs text-destructive">{policyError}</p>}
          {policy && <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Safety stock</p><p>{Math.round(policy.policy.safetyStock)}</p></div>
              <div><p className="text-xs text-muted-foreground">Reorder point (s)</p><p>{Math.round(policy.policy.reorderPoint)}</p></div>
              <div><p className="text-xs text-muted-foreground">Order up to (S)</p><p className="font-semibold">{Math.round(policy.policy.orderUpToLevel)}</p></div>
            </div>
            <p className="text-xs text-muted-foreground">
              Protects {policy.policy.protectionIntervalDays} days (lead time + review period) at {policy.averageDailyDemand.toFixed(2)}/day.{' '}
              90-day simulation: {policy.simulation.plannedOrders.length} order{policy.simulation.plannedOrders.length === 1 ? '' : 's'}
              {policy.simulation.firstStockoutDay != null ? `, first projected stockout on day ${policy.simulation.firstStockoutDay}` : ', no projected stockout'}.
            </p>
          </div>}
        </div>}
      </div>}
    </DialogContent>
  </Dialog>;
}
