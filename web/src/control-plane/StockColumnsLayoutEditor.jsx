import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { controlRequest } from './control-api';
import { moveField } from './ImportColumnsEditor';
import { TableSwitcher } from './TableSwitcher';

export function layoutPayload(columns) {
  return columns.map((column) => ({ key: column.key, label: column.label, visible: column.visible !== false, visibleRoles: column.visibleRoles?.length ? column.visibleRoles : null }));
}

export const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'ADMIN_USER', label: 'Admin user' },
  { value: 'BRANCH_MANAGER', label: 'Branch manager' },
  { value: 'STORE_USER', label: 'Store user' },
  { value: 'WAREHOUSE_PICKER', label: 'Warehouse picker' },
  { value: 'AUDITOR', label: 'Auditor' },
];

/** Plain-language summary of who can see a column. */
export function rolesSummary(visibleRoles) {
  if (!visibleRoles?.length || visibleRoles.length >= ROLE_OPTIONS.length) return 'Everyone';
  return `Only ${ROLE_OPTIONS.filter((role) => visibleRoles.includes(role.value)).map((role) => role.label).join(', ')}`;
}

/** Toggle one role; Admin is always kept, and selecting every role means "everyone" (no list). */
export function toggleRole(visibleRoles, role) {
  if (role === 'ADMIN') return visibleRoles;
  const current = new Set(visibleRoles?.length ? visibleRoles : ROLE_OPTIONS.map((option) => option.value));
  if (current.has(role)) current.delete(role); else current.add(role);
  current.add('ADMIN');
  return current.size >= ROLE_OPTIONS.length ? undefined : ROLE_OPTIONS.filter((option) => current.has(option.value)).map((option) => option.value);
}

/** Columns that can be moved and renamed but never hidden, per table. */
export const LOCKED_COLUMNS = { stock: ['item_code'], lots: ['item_lot', 'open'], itemLots: ['lot_no', 'print'] };

/** Order, names and show/hide of a table's columns. Saved to the draft; publish makes it live. */
export function StockColumnsLayoutEditor({ controlToken, onSaved }) {
  const [table, setTable] = useState('stock');
  const [columns, setColumns] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [itemFields, setItemFields] = useState([]);
  const [pickedField, setPickedField] = useState('');

  const load = useCallback((nextColumns) => {
    setColumns((nextColumns ?? []).map((column) => ({ ...column })));
    setDirty(false);
    setError('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setColumns([]);
    controlRequest(`/studio/v1/draft/columns?table=${table}`, { token: controlToken })
      .then((result) => { if (!cancelled) load(result.columns); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load columns'); });
    return () => { cancelled = true; };
  }, [controlToken, table, load]);

  useEffect(() => {
    let cancelled = false;
    controlRequest('/studio/v1/item-fields', { token: controlToken })
      .then((result) => { if (!cancelled) setItemFields((result.fields ?? []).map((field) => field.name)); })
      .catch(() => { if (!cancelled) setItemFields([]); });
    return () => { cancelled = true; };
  }, [controlToken]);

  const usedFields = new Set(columns.filter((column) => column.itemField).map((column) => column.itemField));
  const availableFields = itemFields.filter((name) => !usedFields.has(name));
  const locked = LOCKED_COLUMNS[table] ?? [];

  const switchTable = (next) => {
    if (next === table) return;
    if (dirty && !window.confirm('Discard unsaved changes to this table?')) return;
    setTable(next);
  };

  async function addItemField() {
    if (!pickedField) return;
    setSaving(true);
    setError('');
    try {
      const result = await controlRequest('/studio/v1/draft/stock/item-field-columns', { token: controlToken, method: 'POST', body: { fieldName: pickedField, table } });
      load(result.columns);
      setPickedField('');
      onSaved?.();
      toast.success('Added to draft. Open "Preview / publish" to make it live.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the field');
    } finally {
      setSaving(false);
    }
  }

  const edit = (index, patch) => { setColumns((current) => current.map((column, i) => (i === index ? { ...column, ...patch } : column))); setDirty(true); };
  const move = (index, direction) => { setColumns((current) => moveField(current, index, direction)); setDirty(true); };

  async function save() {
    setSaving(true);
    setError('');
    try {
      const result = await controlRequest('/studio/v1/draft/stock/column-layout', { token: controlToken, method: 'PUT', body: { columns: layoutPayload(columns), table } });
      load(result.columns);
      onSaved?.();
      toast.success('Saved to draft. Open "Preview / publish" to make it live.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Table columns</CardTitle>
        <p className="text-xs text-muted-foreground">Move columns up or down, rename them, or hide them. People see the table in this order after you publish.</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <TableSwitcher table={table} onChange={switchTable} disabled={saving} />
        <div className="grid gap-2">
          {columns.map((column, index) => (
            <div key={column.key} className={`grid items-center gap-2 rounded-md border p-2 md:grid-cols-[auto_1fr_auto_auto] ${column.visible === false ? 'opacity-60' : ''}`}>
              <div className="flex gap-1">
                <Button type="button" size="icon" variant="outline" aria-label={`Move ${column.label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
                <Button type="button" size="icon" variant="outline" aria-label={`Move ${column.label} down`} disabled={index === columns.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button>
              </div>
              <Input aria-label={`Column name ${index + 1}`} value={column.label} onChange={(event) => edit(index, { label: event.target.value })} />
              <Badge variant="outline">{column.source === 'formula' ? 'Calculated' : column.source === 'itemField' ? 'Item field' : column.source === 'custom' ? 'Your column' : 'Built-in'}</Badge>
              <Button
                type="button"
                size="sm"
                variant={column.visible === false ? 'secondary' : 'outline'}
                disabled={locked.includes(column.key)}
                aria-pressed={column.visible !== false}
                onClick={() => edit(index, { visible: column.visible === false })}
              >
                {column.visible === false ? <><EyeOff className="size-4" />Hidden</> : <><Eye className="size-4" />Shown</>}
              </Button>
              {!locked.includes(column.key) && (
                <details className="text-xs md:col-span-4">
                  <summary className="cursor-pointer text-muted-foreground">Who sees it: <strong>{rolesSummary(column.visibleRoles)}</strong></summary>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {ROLE_OPTIONS.map((role) => {
                      const checked = !column.visibleRoles?.length || column.visibleRoles.includes(role.value);
                      return (
                        <label key={role.value} className="flex items-center gap-1.5">
                          <Checkbox checked={checked} disabled={role.value === 'ADMIN'} aria-label={`${role.label} can see ${column.label}`} onCheckedChange={() => edit(index, { visibleRoles: toggleRole(column.visibleRoles, role.value) })} />
                          {role.label}
                        </label>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        {availableFields.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
            <span className="text-xs text-muted-foreground">Show an item field (like Shelf Rack or MRP) as a column</span>
            <select aria-label="Item field" className="h-8 rounded-md border bg-background px-2 text-sm" value={pickedField} onChange={(event) => setPickedField(event.target.value)}>
              <option value="">Choose a field…</option>
              {availableFields.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <Button type="button" size="sm" variant="outline" disabled={!pickedField || saving || dirty} onClick={addItemField}><Plus className="size-4" />Add column</Button>
            {dirty && <span className="text-xs text-muted-foreground">Save your other changes first.</span>}
          </div>
        )}
        <div><Button type="button" onClick={save} disabled={saving || !dirty}><Save className="size-4" />{saving ? 'Saving…' : 'Save to draft'}</Button></div>
      </CardContent>
    </Card>
  );
}
