import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { controlRequest } from './control-api';
import { moveField } from './ImportColumnsEditor';

export function layoutPayload(columns) {
  return columns.map((column) => ({ key: column.key, label: column.label, visible: column.visible !== false }));
}

/** Order, names and show/hide of the Stock table columns. Saved to the draft; publish makes it live. */
export function StockColumnsLayoutEditor({ controlToken, onSaved }) {
  const [columns, setColumns] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback((draft) => {
    setColumns((draft?.page?.columns ?? []).map((column) => ({ ...column })));
    setDirty(false);
    setError('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    controlRequest('/studio/v1/draft', { token: controlToken })
      .then((result) => { if (!cancelled) load(result.draft); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load columns'); });
    return () => { cancelled = true; };
  }, [controlToken, load]);

  const edit = (index, patch) => { setColumns((current) => current.map((column, i) => (i === index ? { ...column, ...patch } : column))); setDirty(true); };
  const move = (index, direction) => { setColumns((current) => moveField(current, index, direction)); setDirty(true); };

  async function save() {
    setSaving(true);
    setError('');
    try {
      const result = await controlRequest('/studio/v1/draft/stock/column-layout', { token: controlToken, method: 'PUT', body: { columns: layoutPayload(columns) } });
      load(result.draft);
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
        <CardTitle className="text-base">Stock table columns</CardTitle>
        <p className="text-xs text-muted-foreground">Move columns up or down, rename them, or hide them. People see the table in this order after you publish.</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2">
          {columns.map((column, index) => (
            <div key={column.key} className={`grid items-center gap-2 rounded-md border p-2 md:grid-cols-[auto_1fr_auto_auto] ${column.visible === false ? 'opacity-60' : ''}`}>
              <div className="flex gap-1">
                <Button type="button" size="icon" variant="outline" aria-label={`Move ${column.label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
                <Button type="button" size="icon" variant="outline" aria-label={`Move ${column.label} down`} disabled={index === columns.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button>
              </div>
              <Input aria-label={`Column name ${index + 1}`} value={column.label} onChange={(event) => edit(index, { label: event.target.value })} />
              <Badge variant="outline">{column.source === 'custom' ? 'Your column' : 'Built-in'}</Badge>
              <Button
                type="button"
                size="sm"
                variant={column.visible === false ? 'secondary' : 'outline'}
                disabled={column.key === 'item_code'}
                aria-pressed={column.visible !== false}
                onClick={() => edit(index, { visible: column.visible === false })}
              >
                {column.visible === false ? <><EyeOff className="size-4" />Hidden</> : <><Eye className="size-4" />Shown</>}
              </Button>
            </div>
          ))}
        </div>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        <div><Button type="button" onClick={save} disabled={saving || !dirty}><Save className="size-4" />{saving ? 'Saving…' : 'Save to draft'}</Button></div>
      </CardContent>
    </Card>
  );
}
