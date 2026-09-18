import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client';
import {
  ALLOCATION_STRATEGIES,
  COUNT_METHODS,
  PICK_METHODS,
  describeDeleteBlockers,
  formToPayload,
  itemStatusMeta,
  itemToForm,
} from '../lib/item-master';
import { formatDateTime } from '../lib/workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const selectClass = 'h-9 w-full rounded-md border bg-background px-2 text-sm';

function Field({ label, children, hint }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

// Edit one item's canonical master, or (mode "archived") restore items that
// were archived/deactivated. Everything goes through the same scoped API the
// rest of the app uses, so role rules stay on the server.
export default function ItemMasterPanel({ mode, item, token, role, onClose, onItemsChanged }) {
  return mode === 'archived'
    ? <ArchivedItems token={token} onClose={onClose} onItemsChanged={onItemsChanged} />
    : <EditItem item={item} token={token} role={role} onClose={onClose} onItemsChanged={onItemsChanged} />;
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}

function EditItem({ item, token, role, onClose, onItemsChanged }) {
  const [current, setCurrent] = useState(item);
  const [form, setForm] = useState(() => itemToForm(item));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [references, setReferences] = useState(null);
  const mounted = useMounted();
  const headers = { Authorization: `Bearer ${token}` };
  const status = current.status ?? 'ACTIVE';
  const set = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  useEffect(() => {
    apiRequest(`/api/v1/items/${item.id}/references`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (mounted.current) setReferences(response); })
      .catch(() => { if (mounted.current) setReferences(null); });
  }, [item.id, token, current.version, mounted]);

  async function refreshItems() {
    try {
      const response = await apiRequest('/api/v1/items', { headers });
      onItemsChanged?.(response.items ?? []);
    } catch { /* the live stream / next refresh will catch up */ }
  }

  async function run(action) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'The request failed.'); } finally { if (mounted.current) setBusy(false); }
  }

  const save = () => {
    const checked = formToPayload(form);
    if (!checked.ok) { setError(checked.errors.join(' ')); return; }
    return run(async () => {
      const response = await apiRequest(`/api/v1/items/${item.id}`, { method: 'PUT', headers, body: JSON.stringify(checked.payload) });
      if (!mounted.current) return;
      setCurrent(response.item);
      setForm(itemToForm(response.item));
      setNotice(`Saved (version ${response.item.version}).`);
      await refreshItems();
    });
  };

  const changeStatus = (next) => run(async () => {
    const response = await apiRequest(`/api/v1/items/${item.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: next, reason }) });
    if (!mounted.current) return;
    setCurrent(response.item);
    setReason('');
    setNotice(next === 'ACTIVE' ? 'Item restored - it is available for operations again.' : `Item ${next === 'ARCHIVED' ? 'archived' : 'deactivated'}. History is kept.`);
    await refreshItems();
  });

  const remove = () => {
    if (!window.confirm(`Permanently delete ${current.code}? This cannot be undone.`)) return;
    return run(async () => {
      await apiRequest(`/api/v1/items/${item.id}`, { method: 'DELETE', headers });
      await refreshItems();
      onClose();
    });
  };

  const meta = itemStatusMeta(status);
  const canDelete = role === 'ADMIN' && references?.canDelete;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Item master <Badge variant={meta.variant}>{meta.label}</Badge></DialogTitle>
          <DialogDescription>
            {current.code} · version {current.version ?? 1}
            {current.updatedById ? ` · last edited by ${current.updatedById}` : ''}
          </DialogDescription>
        </DialogHeader>

        {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}
        {notice && <div role="status" className="rounded-lg border p-3 text-sm">{notice}</div>}

        <div className="grid gap-3">
          <Section title="Identity">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Item Code (SKU)"><Input value={form.code} onChange={set('code')} /></Field>
              <Field label="Item Name"><Input value={form.name} onChange={set('name')} /></Field>
              <Field label="Brand / company"><Input value={form.company} onChange={set('company')} /></Field>
              <Field label="Category"><Input value={form.category} onChange={set('category')} /></Field>
              <Field label="Sub category"><Input value={form.subcategory} onChange={set('subcategory')} /></Field>
            </div>
          </Section>

          <Section title="Measurement, barcode and lot">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Unit / pack size"><Input value={form.unit} onChange={set('unit')} placeholder="PCS, KG, 5kg bag…" /></Field>
              <Field label="Item barcode" hint="Scanning this barcode identifies the item.">
                <Input value={form.barcode} onChange={set('barcode')} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.decimalQuantity} onChange={set('decimalQuantity')} />Decimal quantity (loose / KG)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.lotRequired} onChange={set('lotRequired')} />Lot required</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.expiryRequired} onChange={set('expiryRequired')} />Expiry required</label>
            </div>
          </Section>

          <Section title="Counting and picking">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Count method">
                <select className={selectClass} value={form.countMethod} onChange={set('countMethod')}>{COUNT_METHODS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>
              </Field>
              <Field label="Pick method">
                <select className={selectClass} value={form.pickMethod} onChange={set('pickMethod')}>{PICK_METHODS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>
              </Field>
              <Field label="Lot allocation">
                <select className={selectClass} value={form.allocationStrategy} onChange={set('allocationStrategy')}>{ALLOCATION_STRATEGIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>
              </Field>
            </div>
          </Section>

          <Section title="Commercial and planning">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="HSN"><Input value={form.hsn} onChange={set('hsn')} /></Field>
              <Field label="GST rate (%)"><Input type="number" min="0" max="100" step="0.01" value={form.gstRate} onChange={set('gstRate')} /></Field>
              <Field label="MRP (₹)"><Input type="number" min="0" step="0.01" value={form.mrp} onChange={set('mrp')} /></Field>
              <Field label="Supplier lead time (days)"><Input type="number" min="0" step="1" value={form.leadTimeDays} onChange={set('leadTimeDays')} /></Field>
              <Field label="Shelf life (days)"><Input type="number" min="0" step="1" value={form.shelfLifeDays} onChange={set('shelfLifeDays')} /></Field>
            </div>
          </Section>

          <Section title="ERP aliases">
            <Field label="Alternate names and codes" hint="Comma separated. Import rows that use any of these resolve to this item; no other item may use them.">
              <Input value={form.aliases} onChange={set('aliases')} placeholder="ERP-1001, Basmati Rice 5 kg" />
            </Field>
          </Section>

          <div className="flex justify-end"><Button onClick={save} disabled={busy}>Save item</Button></div>

          <Section title="Lifecycle">
            {status === 'ACTIVE' ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">Archiving keeps all history but hides the item from store users and pickers and blocks new transactions.</p>
                <div className="flex flex-wrap gap-2">
                  <Input className="max-w-xs" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (required)" aria-label="Reason" />
                  <Button variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => changeStatus('INACTIVE')}>Deactivate</Button>
                  <Button variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => changeStatus('ARCHIVED')}>Archive</Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">{meta.label}{current.archiveReason ? ` - ${current.archiveReason}` : ''}{current.archivedAt ? ` (${formatDateTime(current.archivedAt)})` : ''}</p>
                <div><Button disabled={busy} onClick={() => changeStatus('ACTIVE')}>Restore</Button></div>
              </div>
            )}
            <div className="grid gap-1 border-t pt-3">
              <p className="text-sm font-medium">Permanent delete</p>
              {references === null ? <p className="text-xs text-muted-foreground">Checking history…</p>
                : references.canDelete ? <p className="text-xs text-muted-foreground">This item has no stock, movements, counts or orders, so it can be deleted.</p>
                  : <p className="text-xs text-muted-foreground">Cannot delete: it has {describeDeleteBlockers(references.blockers)}. Archive it instead so reports stay explainable.</p>}
              {role === 'ADMIN'
                ? <div><Button variant="destructive" size="sm" disabled={busy || !canDelete} onClick={remove}>Delete permanently</Button></div>
                : <p className="text-xs text-muted-foreground">Only the Main Admin can permanently delete items.</p>}
            </div>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ArchivedItems({ token, onClose, onItemsChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busyId, setBusyId] = useState('');
  const mounted = useMounted();
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    apiRequest('/api/v1/items?status=all', { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (mounted.current) setRows((response.items ?? []).filter((entry) => (entry.status ?? 'ACTIVE') !== 'ACTIVE')); })
      .catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load items.'); });
  }, [token, revision, mounted]);

  async function restore(item) {
    setBusyId(item.id); setError('');
    try {
      await apiRequest(`/api/v1/items/${item.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'ACTIVE' }) });
      const response = await apiRequest('/api/v1/items', { headers });
      onItemsChanged?.(response.items ?? []);
      if (mounted.current) setRevision((value) => value + 1);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to restore the item.');
    } finally {
      if (mounted.current) setBusyId('');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Archived and inactive items</DialogTitle>
          <DialogDescription>Hidden from store users and pickers. Restore an item to make it available again.</DialogDescription>
        </DialogHeader>
        {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}
        {rows === null ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          : !rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">No archived or inactive items.</p>
            : (
              <div className="divide-y rounded-lg border">
                {rows.map((row) => {
                  const meta = itemStatusMeta(row.status);
                  return (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div>
                        <p className="text-sm font-medium">{row.name} <Badge variant={meta.variant} className="ml-1">{meta.label}</Badge></p>
                        <p className="text-xs text-muted-foreground">{row.code}{row.archiveReason ? ` · ${row.archiveReason}` : ''}{row.archivedAt ? ` · ${formatDateTime(row.archivedAt)}` : ''}</p>
                      </div>
                      <Button size="sm" disabled={busyId === row.id} onClick={() => restore(row)}>Restore</Button>
                    </div>
                  );
                })}
              </div>
            )}
      </DialogContent>
    </Dialog>
  );
}
