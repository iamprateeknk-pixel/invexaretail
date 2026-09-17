import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

const MOVE_OPTIONS = [
  { movementType: 'PICK', toStatus: 'RESERVED', label: 'Reserve' },
  { movementType: 'SALE', toStatus: 'SOLD', label: 'Sell' },
  { movementType: 'RETURN', toStatus: 'RETURNED', label: 'Return' },
  { movementType: 'ADJUSTMENT', toStatus: 'IN_STOCK', label: 'Restock' },
  { movementType: 'ADJUSTMENT', toStatus: 'DAMAGED', label: 'Mark damaged' },
  { movementType: 'ADJUSTMENT', toStatus: 'LOST', label: 'Mark lost' },
];

export default function ItemSerialPanel({ item, token, apiBase, canManage, onClose }) {
  const [serials, setSerials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newSerial, setNewSerial] = useState('');
  const [revision, setRevision] = useState(0);
  const [trace, setTrace] = useState(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const listEndpoint = apiBase + '/api/v1/items/' + encodeURIComponent(item.id) + '/serials';
  const headers = { Authorization: 'Bearer ' + token };

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError('');
    (async () => {
      try {
        const response = await fetch(listEndpoint, { headers, signal: abort.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Unable to load serials. Please retry.');
        if (!abort.signal.aborted) setSerials(data.serials ?? []);
      } catch (err) {
        if (!abort.signal.aborted) setError(err.message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listEndpoint, token, revision]);

  async function register(event) {
    event.preventDefault();
    const serial = newSerial.trim();
    if (!serial) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(listEndpoint, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Serial was not registered. Retry.');
      if (mounted.current) { setNewSerial(''); setRevision((value) => value + 1); }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function viewTrace(serial) {
    setBusy(true); setError('');
    try {
      const response = await fetch(apiBase + '/api/v1/serials/' + encodeURIComponent(serial), { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to load recall trace.');
      if (mounted.current) setTrace(data);
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function move(serial, movementType, toStatus) {
    setBusy(true); setError('');
    try {
      const response = await fetch(apiBase + '/api/v1/serials/' + encodeURIComponent(serial) + '/move', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ movementType, toStatus }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Serial could not be moved.');
      if (mounted.current) { setRevision((value) => value + 1); setTrace(null); }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Serial numbers</DialogTitle><DialogDescription>{item.code} · {item.name}</DialogDescription></DialogHeader>
      {canManage && <form onSubmit={register} className="flex gap-2">
        <Input placeholder="Register a serial…" value={newSerial} onChange={(event) => setNewSerial(event.target.value)} disabled={busy} />
        <Button type="submit" disabled={busy || !newSerial.trim()}>Register</Button>
      </form>}
      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}
      {loading ? <p role="status">Loading serials…</p> : !serials.length ? <p className="py-6 text-center text-muted-foreground">No serials registered for this item yet.</p> : (
        <ul className="grid gap-2">
          {serials.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-sm">{entry.serial}</p>
              <Badge variant="outline" className="mt-1">{entry.status}</Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => viewTrace(entry.serial)}>Trace</Button>
              {canManage && MOVE_OPTIONS.map((option) => <Button key={option.label} size="sm" variant="ghost" disabled={busy} onClick={() => move(entry.serial, option.movementType, option.toStatus)}>{option.label}</Button>)}
            </div>
          </li>)}
        </ul>
      )}
      {trace && <div className="rounded-lg border bg-muted/25 p-3">
        <p className="mb-2 text-sm font-medium">Recall trace · {trace.serial?.serial}</p>
        <ol className="grid gap-1 text-sm">
          {trace.trace.map((step, index) => <li key={index}>{new Date(step.at).toLocaleString()} — {step.event}{step.reference ? ` (${step.reference})` : ''}</li>)}
        </ol>
      </div>}
    </DialogContent>
  </Dialog>;
}
