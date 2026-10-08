import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { controlRequest } from './control-api';

const TYPE_LABELS = { text: 'Text', number: 'Number', date: 'Date' };

export function moveField(fields, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= fields.length) return fields;
  const next = [...fields];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function newCustomField(existing) {
  let n = existing.filter((field) => field.custom).length + 1;
  let label = `New column ${n}`;
  while (existing.some((field) => field.label.toLowerCase() === label.toLowerCase())) { n += 1; label = `New column ${n}`; }
  return { key: '', label, custom: true, type: 'text', enabled: true, required: false, aliases: [] };
}

/** Plain-language editor for the Excel import columns of the locked company. */
export function ImportColumnsEditor({ controlToken }) {
  const [fields, setFields] = useState([]);
  const [isDefault, setIsDefault] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const apply = useCallback((result) => {
    setFields(result.profile.fields);
    setIsDefault(Boolean(result.isDefault));
    setDirty(false);
    setError('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    controlRequest('/studio/v1/import-profile', { token: controlToken })
      .then((result) => { if (!cancelled) apply(result); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load import columns'); });
    return () => { cancelled = true; };
  }, [controlToken, apply]);

  const edit = (index, patch) => {
    setFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));
    setDirty(true);
  };
  const reorder = (index, direction) => { setFields((current) => moveField(current, index, direction)); setDirty(true); };

  async function save() {
    setSaving(true);
    setError('');
    try {
      apply(await controlRequest('/studio/v1/import-profile', { token: controlToken, method: 'PUT', body: { fields } }));
      toast.success('Import columns saved. The next import uses this layout.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      apply(await controlRequest('/studio/v1/import-profile', { token: controlToken, method: 'DELETE' }));
      toast.message('Back to the standard import columns');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  }

  const live = fields.filter((field) => field.enabled);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Excel import columns</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Move columns up or down, rename them, mark them required, turn them off, or add your own. The import and the downloadable template follow this list.
          </p>
        </div>
        <Badge variant={isDefault ? 'secondary' : 'success'}>{isDefault ? 'Standard layout' : 'Custom layout'}</Badge>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Your Excel file will have these columns, in this order</p>
          <div className="flex flex-wrap gap-1" aria-label="Column order preview">
            {live.map((field, i) => (
              <span key={field.key + i} className="rounded border bg-background px-2 py-0.5 text-xs">
                {i + 1}. {field.label}{field.required ? ' *' : ''}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          {fields.map((field, index) => (
            <div key={field.key + index} className={`grid gap-2 rounded-md border p-3 md:grid-cols-[auto_1fr_1fr_auto_auto] md:items-center ${field.enabled ? '' : 'opacity-60'}`}>
              <div className="flex gap-1">
                <Button type="button" size="icon" variant="outline" aria-label={`Move ${field.label} up`} disabled={index === 0} onClick={() => reorder(index, -1)}><ArrowUp className="size-4" /></Button>
                <Button type="button" size="icon" variant="outline" aria-label={`Move ${field.label} down`} disabled={index === fields.length - 1} onClick={() => reorder(index, 1)}><ArrowDown className="size-4" /></Button>
              </div>
              <div className="grid gap-1">
                <Input aria-label={`Column name ${index + 1}`} value={field.label} onChange={(event) => edit(index, { label: event.target.value })} />
                {field.custom ? (
                  <select
                    aria-label={`Type of ${field.label}`}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    value={field.type}
                    onChange={(event) => edit(index, { type: event.target.value })}
                  >
                    {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>Your column · {label}</option>)}
                  </select>
                ) : (
                  <span className="text-xs text-muted-foreground">Built-in · {TYPE_LABELS[field.type]}</span>
                )}
              </div>
              <div className="grid gap-1">
                <Input
                  aria-label={`Other names for ${field.label}`}
                  placeholder="Other header names, comma separated"
                  value={(field.aliases ?? []).join(', ')}
                  onChange={(event) => edit(index, { aliases: event.target.value.split(',').map((part) => part.trim()).filter(Boolean) })}
                />
                <Input
                  aria-label={`Default value for ${field.label}`}
                  placeholder="Default when empty (optional)"
                  value={field.defaultValue ?? ''}
                  onChange={(event) => edit(index, { defaultValue: event.target.value })}
                />
              </div>
              <div className="grid gap-2 text-xs">
                <label className="flex items-center gap-2">
                  <Checkbox checked={field.enabled} disabled={field.key === 'itemName'} onCheckedChange={(value) => edit(index, { enabled: Boolean(value), required: value ? field.required : false })} />
                  Use
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={field.required} disabled={!field.enabled || field.key === 'itemName'} onCheckedChange={(value) => edit(index, { required: Boolean(value) })} />
                  Required
                </label>
              </div>
              <div className="flex justify-end">
                {field.custom && (
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${field.label}`} onClick={() => { setFields((current) => current.filter((_, i) => i !== index)); setDirty(true); }}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { setFields((current) => [...current, newCustomField(current)]); setDirty(true); }}><Plus className="size-4" />Add column</Button>
          <Button type="button" onClick={save} disabled={saving || !dirty}><Save className="size-4" />{saving ? 'Saving…' : 'Save columns'}</Button>
          <Button type="button" variant="ghost" onClick={reset} disabled={saving || isDefault}><RotateCcw className="size-4" />Back to standard</Button>
        </div>
      </CardContent>
    </Card>
  );
}
