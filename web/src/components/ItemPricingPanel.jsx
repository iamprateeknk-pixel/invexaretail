import { useEffect, useRef, useState } from 'react';
import { apiRequest, API_BASE } from '../lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PRICE_TYPES = ['MRP', 'RETAIL', 'WHOLESALE', 'INSTITUTIONAL', 'WEB', 'MARKETPLACE', 'PROMOTIONAL'];

const EMPTY_FORM = { priceType: 'RETAIL', price: '', mrp: '', landedCost: '', minMarginPercent: '', branchId: '', effectiveFrom: '', effectiveTo: '' };

export default function ItemPricingPanel({ item, token, canManage, onClose }) {
  const [priceLists, setPriceLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [guardrail, setGuardrail] = useState(null);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const headers = { Authorization: `Bearer ${token}` };
  const listPath = `/api/v1/items/${encodeURIComponent(item.id)}/prices`;

  useEffect(() => {
    setLoading(true); setError('');
    apiRequest(listPath, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (mounted.current) setPriceLists(response.priceLists ?? []); })
      .catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load prices.'); })
      .finally(() => { if (mounted.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listPath, token, revision]);

  async function submit(event) {
    event.preventDefault();
    if (!form.price) return;
    setBusy(true); setError(''); setGuardrail(null);
    try {
      const body = {
        priceType: form.priceType,
        price: Number(form.price),
        ...(form.mrp ? { mrp: Number(form.mrp) } : {}),
        ...(form.landedCost ? { landedCost: Number(form.landedCost) } : {}),
        ...(form.minMarginPercent ? { minMarginPercent: Number(form.minMarginPercent) } : {}),
        ...(form.branchId ? { branchId: form.branchId } : {}),
        ...(form.effectiveFrom ? { effectiveFrom: new Date(form.effectiveFrom).toISOString() } : {}),
        ...(form.effectiveTo ? { effectiveTo: new Date(form.effectiveTo).toISOString() } : {}),
      };
      const response = await fetch(`${API_BASE}${listPath}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (mounted.current) { setError(data.message || 'Price was not saved.'); setGuardrail(data.guardrail ?? null); }
        return;
      }
      if (mounted.current) {
        setGuardrail(data.guardrail ?? null);
        setForm(EMPTY_FORM);
        setRevision((value) => value + 1);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Price was not saved.');
    } finally { if (mounted.current) setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Retail pricing</DialogTitle><DialogDescription>{item.code} · {item.name}</DialogDescription></DialogHeader>

      {canManage && <form onSubmit={submit} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
        <Select value={form.priceType} onValueChange={(priceType) => setForm({ ...form, priceType })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PRICE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" min="0" step="0.01" placeholder="Price" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required />
        <Input type="number" min="0" step="0.01" placeholder="MRP (optional)" value={form.mrp} onChange={(event) => setForm({ ...form, mrp: event.target.value })} />
        <Input type="number" min="0" step="0.01" placeholder="Landed cost (optional)" value={form.landedCost} onChange={(event) => setForm({ ...form, landedCost: event.target.value })} />
        <Input type="number" min="0" step="0.1" placeholder="Min margin % (optional)" value={form.minMarginPercent} onChange={(event) => setForm({ ...form, minMarginPercent: event.target.value })} />
        <Input placeholder="Branch id (blank = company-wide)" value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })} />
        <div className="grid gap-1.5"><Label className="text-xs">Effective from</Label><Input type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} /></div>
        <div className="grid gap-1.5"><Label className="text-xs">Effective to (optional)</Label><Input type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })} /></div>
        <Button type="submit" disabled={busy || !form.price} className="sm:col-span-2">Save price</Button>
      </form>}

      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}
      {guardrail?.violations?.length > 0 && <div className="rounded-lg border border-warning p-3 text-sm">
        {guardrail.violations.map((violation, index) => <p key={index} className={violation.severity === 'BLOCK' ? 'text-destructive' : 'text-warning-foreground'}>{violation.message}</p>)}
      </div>}

      {loading ? <p role="status">Loading prices…</p> : !priceLists.length ? <p className="py-6 text-center text-muted-foreground">No prices set for this item yet.</p> : (
        <ul className="grid gap-2">
          {priceLists.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <div>
              <div className="flex items-center gap-2"><Badge variant="outline">{entry.priceType}</Badge>{entry.branchId && <Badge variant="secondary">Branch: {entry.branchId}</Badge>}</div>
              <p className="mt-1 text-lg font-semibold">₹{entry.price}</p>
              <p className="text-xs text-muted-foreground">
                From {new Date(entry.effectiveFrom).toLocaleDateString()}{entry.effectiveTo ? ` to ${new Date(entry.effectiveTo).toLocaleDateString()}` : ' · no end date'}
              </p>
            </div>
          </li>)}
        </ul>
      )}
    </DialogContent>
  </Dialog>;
}
