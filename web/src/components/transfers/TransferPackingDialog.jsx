import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api-client';
import { cartonPayload, dispatchPayload, remainingLines } from '../../lib/transfer-packing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const newRequestId = () => `carton-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Blueprint v4 §16 Packing + §17 Dispatch: seal cartons against what was
// picked, complete packing, then record who carries it and when it is due.
export default function TransferPackingDialog({ transfer, token, itemsById, canDispatch, onChanged, onClose }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [weightKg, setWeightKg] = useState('');
  const [dispatch, setDispatch] = useState({ carrier: '', awb: '', vehicleNo: '', expectedArrivalAt: '' });
  // One key per carton being built, so a double click or retry seals it once.
  const [requestId, setRequestId] = useState(newRequestId);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const next = await apiRequest(`/api/v1/transfers/${encodeURIComponent(transfer.id)}/pack`, { headers: { Authorization: `Bearer ${token}` } });
      if (mounted.current) { setState(next); setError(''); }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load packing.');
    }
  }, [transfer.id, token]);
  useEffect(() => { load(); }, [load]);

  async function act(path, body, after) {
    setBusy(true); setError('');
    try {
      const response = await apiRequest(`/api/v1/transfers/${encodeURIComponent(transfer.id)}${path}`, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined });
      if (!mounted.current) return;
      if (response.cartons) setState(response);
      after?.(response);
      await onChanged?.();
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : 'That did not work.');
        await load();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const lines = remainingLines(state);
  const label = (line) => {
    const item = itemsById?.get(line.itemId);
    return item ? `${item.code} - ${item.name}` : line.itemId;
  };

  function sealCarton() {
    try {
      const body = cartonPayload(lines, quantities, weightKg, requestId);
      act('/cartons', body, () => { setQuantities({}); setWeightKg(''); setRequestId(newRequestId()); });
    } catch (err) {
      setError(err.message);
    }
  }

  function fillRemaining() {
    setQuantities(Object.fromEntries(lines.filter((line) => line.remaining > 0).map((line) => [`${line.itemId}|${line.lotId}`, String(line.remaining)])));
  }

  function sendOut() {
    try {
      act('/dispatch', dispatchPayload(dispatch), () => onClose());
    } catch (err) {
      setError(err.message);
    }
  }

  const cartons = (state?.cartons ?? []).filter((carton) => carton.status === 'SEALED');
  const packed = Boolean(state?.packingComplete);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pack &amp; dispatch - {transfer.id}</DialogTitle>
          <DialogDescription>{transfer.fromName} to {transfer.toName}. Every picked line must be in a sealed carton before it can leave.</DialogDescription>
        </DialogHeader>
        {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}
        {!state ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading packing…</p> : (
          <div className="space-y-4">
            <div className="rounded-lg border">
              <div className="border-b p-3 text-sm font-medium">Picked lines</div>
              <div className="divide-y">
                {lines.map((line) => (
                  <div key={`${line.itemId}|${line.lotId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{label(line)}</p>
                      <p className="text-xs text-muted-foreground">Packed {line.packed} of {line.expected}{line.remaining > 0 ? ` · ${line.remaining} left` : ' · complete'}</p>
                    </div>
                    {!packed && line.remaining > 0 && (
                      <Input aria-label={`Quantity of ${label(line)} in this carton`} className="h-8 w-28" inputMode="decimal" placeholder="Qty" value={quantities[`${line.itemId}|${line.lotId}`] ?? ''}
                        onChange={(event) => setQuantities({ ...quantities, [`${line.itemId}|${line.lotId}`]: event.target.value })} />
                    )}
                  </div>
                ))}
              </div>
              {!packed && (
                <div className="flex flex-wrap items-center gap-2 border-t p-3">
                  <Input aria-label="Carton weight in kg" className="h-8 w-32" inputMode="decimal" placeholder="Weight (kg)" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} />
                  <Button size="sm" variant="outline" onClick={fillRemaining} disabled={busy}>Fill what is left</Button>
                  <Button size="sm" onClick={sealCarton} disabled={busy}>Seal carton</Button>
                </div>
              )}
            </div>

            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b p-3 text-sm font-medium">Cartons<Badge variant={packed ? 'success' : 'outline'}>{packed ? 'Packing complete' : `${cartons.length} sealed`}</Badge></div>
              {cartons.length ? cartons.map((carton) => (
                <div key={carton.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{carton.packageId}</p>
                    <p className="text-xs text-muted-foreground">{carton.quantity} units{carton.weightKg ? ` · ${carton.weightKg} kg` : ''}</p>
                  </div>
                  {!packed && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(`/cartons/${encodeURIComponent(carton.id)}/void`)}>Void</Button>}
                </div>
              )) : <p className="p-3 text-xs text-muted-foreground">No carton sealed yet.</p>}
              {!packed && (
                <div className="border-t p-3">
                  <Button size="sm" disabled={busy || !state.canComplete} onClick={() => act('/pack/complete')}>Complete packing</Button>
                  {!state.canComplete && <span className="ml-2 text-xs text-muted-foreground">Available once every line is fully packed.</span>}
                </div>
              )}
            </div>

            {packed && canDispatch && (
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">Dispatch</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label="Courier or carrier" placeholder="Courier / carrier" value={dispatch.carrier} onChange={(event) => setDispatch({ ...dispatch, carrier: event.target.value })} />
                  <Input aria-label="AWB" placeholder="AWB / tracking no." value={dispatch.awb} onChange={(event) => setDispatch({ ...dispatch, awb: event.target.value })} />
                  <Input aria-label="Vehicle number" placeholder="Vehicle number" value={dispatch.vehicleNo} onChange={(event) => setDispatch({ ...dispatch, vehicleNo: event.target.value })} />
                  <Input aria-label="Expected arrival" type="datetime-local" value={dispatch.expectedArrivalAt} onChange={(event) => setDispatch({ ...dispatch, expectedArrivalAt: event.target.value })} />
                </div>
                <Button className="mt-3" disabled={busy} onClick={sendOut}>Dispatch transfer</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
