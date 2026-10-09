import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const UNASSIGNED = '';

// An admin or branch manager hands a queued transfer to one named picker. Only that picker then
// sees and picks it, and gets a notification; "Any picker" puts it back in every picker's queue.
export default function AssignPickerDialog({ transfer, token, onAssigned, onClose }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign picker</DialogTitle>
          <DialogDescription>
            {transfer.id}: {transfer.fromName} to {transfer.toName}. Only the chosen picker will see this transfer, and they get a notification.
          </DialogDescription>
        </DialogHeader>
        <AssignPickerForm transfer={transfer} token={token} onAssigned={onAssigned} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

// The dialog body on its own, so it can be rendered and tested without the modal layer.
export function AssignPickerForm({ transfer, token, onAssigned, onClose }) {
  const [pickers, setPickers] = useState(null);
  const [pickerId, setPickerId] = useState(transfer.assignedPickerId ?? UNASSIGNED);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    apiRequest(`/api/v1/transfers/${encodeURIComponent(transfer.id)}/eligible-pickers`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!mounted.current) return;
        setPickers(response.pickers ?? []);
        setPickerId(response.assignedPickerId ?? UNASSIGNED);
      })
      .catch((err) => { if (mounted.current) { setPickers([]); setError(err instanceof Error ? err.message : 'Unable to load pickers.'); } });
  }, [transfer.id, token]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await apiRequest(`/api/v1/transfers/${encodeURIComponent(transfer.id)}/picker`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pickerId: pickerId || null }),
      });
      onAssigned?.(response.transfer);
      onClose();
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to assign the picker.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const unchanged = pickerId === (transfer.assignedPickerId ?? UNASSIGNED);

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="assign-picker-select">Picker</Label>
        <select
          id="assign-picker-select"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={pickerId}
          disabled={pickers === null || busy}
          onChange={(event) => setPickerId(event.target.value)}
        >
          <option value={UNASSIGNED}>Any picker at {transfer.fromName}</option>
          {(pickers ?? []).map((picker) => <option key={picker.id} value={picker.id}>{picker.name} ({picker.email})</option>)}
        </select>
        {pickers === null && <p className="text-xs text-muted-foreground" role="status">Loading pickers…</p>}
        {pickers?.length === 0 && !error && <p className="text-xs text-muted-foreground" role="status">No warehouse picker is assigned to {transfer.fromName} yet. Give a picker this location in user settings first.</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || pickers === null || unchanged}>{busy ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </>
  );
}
