import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client';
import { statusBadgeVariant, formatDateTime } from '../lib/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DISPOSITIONS = ['RESTOCK', 'SCRAP', 'RETURN_TO_VENDOR'];

export default function OrderReturnsPanel({ order, token, canManage, onClose }) {
  const [returnRequests, setReturnRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [selectedLines, setSelectedLines] = useState({});
  const [dispositions, setDispositions] = useState({});
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const headers = { Authorization: `Bearer ${token}` };
  const eligibleLines = (order.lines ?? []).filter((line) => (line.fulfilledQty ?? 0) > 0);

  useEffect(() => {
    setLoading(true); setError('');
    apiRequest(`/api/v1/orders/${order.id}/returns`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (mounted.current) setReturnRequests(response.returnRequests ?? []); })
      .catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load returns.'); })
      .finally(() => { if (mounted.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, token, revision]);

  async function requestReturn(event) {
    event.preventDefault();
    const lines = eligibleLines
      .filter((line) => selectedLines[line.id] > 0)
      .map((line) => ({ orderLineId: line.id, quantity: Number(selectedLines[line.id]) }));
    if (!lines.length) return;
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/v1/orders/${order.id}/returns`, {
        method: 'POST', headers, body: JSON.stringify({ reason: reason || undefined, lines }),
      });
      if (mounted.current) { setSelectedLines({}); setReason(''); setRevision((value) => value + 1); }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Return request could not be created.');
    } finally { if (mounted.current) setBusy(false); }
  }

  async function applyAction(returnRequest, action) {
    setBusy(true); setError('');
    try {
      const body = { action };
      if (action === 'RECEIVE') {
        body.dispositions = Object.fromEntries(returnRequest.lines.map((line) => [line.id, dispositions[line.id] ?? 'RESTOCK']));
      }
      await apiRequest(`/api/v1/returns/${returnRequest.id}/status`, { method: 'PATCH', headers, body: JSON.stringify(body) });
      if (mounted.current) setRevision((value) => value + 1);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to update this return.');
    } finally { if (mounted.current) setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Returns / RMA</DialogTitle><DialogDescription>{order.channel}{order.customerName ? ` · ${order.customerName}` : ''}</DialogDescription></DialogHeader>

      {canManage && eligibleLines.length > 0 && <form onSubmit={requestReturn} className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">Open a return</p>
        {eligibleLines.map((line) => <div key={line.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1">{line.item?.code ?? line.itemId} · fulfilled {line.fulfilledQty}</span>
          <Input type="number" min="0" max={line.fulfilledQty} className="w-24" placeholder="Qty" value={selectedLines[line.id] ?? ''} onChange={(event) => setSelectedLines({ ...selectedLines, [line.id]: event.target.value })} />
        </div>)}
        <Input placeholder="Reason (optional)" value={reason} onChange={(event) => setReason(event.target.value)} />
        <Button type="submit" size="sm" disabled={busy}>Request return</Button>
      </form>}

      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}

      {loading ? <p role="status">Loading returns…</p> : !returnRequests.length ? <p className="py-6 text-center text-muted-foreground">No returns requested for this order yet.</p> : (
        <ul className="grid gap-3">
          {returnRequests.map((request) => <li key={request.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={statusBadgeVariant(request.status)}>{request.status}</Badge>
              <span className="text-xs text-muted-foreground">{formatDateTime(request.createdAt)}</span>
            </div>
            {request.reason && <p className="mt-1 text-xs text-muted-foreground">{request.reason}</p>}
            <ul className="mt-2 space-y-1 text-sm">
              {request.lines.map((line) => <li key={line.id} className="flex items-center justify-between gap-2">
                <span>{line.itemId} × {line.quantity}{line.disposition ? ` — ${line.disposition}` : ''}</span>
                {canManage && request.status === 'APPROVED' && !line.disposition && (
                  <Select value={dispositions[line.id] ?? 'RESTOCK'} onValueChange={(value) => setDispositions({ ...dispositions, [line.id]: value })}>
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{DISPOSITIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </li>)}
            </ul>
            {canManage && <div className="mt-3 flex flex-wrap gap-2">
              {request.status === 'REQUESTED' && <>
                <Button size="sm" disabled={busy} onClick={() => applyAction(request, 'APPROVE')}>Approve</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => applyAction(request, 'REJECT')}>Reject</Button>
              </>}
              {request.status === 'APPROVED' && <Button size="sm" disabled={busy} onClick={() => applyAction(request, 'RECEIVE')}>Receive</Button>}
              {request.status === 'RECEIVED' && <Button size="sm" disabled={busy} onClick={() => applyAction(request, 'CLOSE')}>Close</Button>}
            </div>}
          </li>)}
        </ul>
      )}
    </DialogContent>
  </Dialog>;
}
