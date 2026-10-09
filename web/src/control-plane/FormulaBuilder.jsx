import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { checkStockFormula, formatStockFormulaValue, STOCK_FORMULA_FIELD_OPTIONS } from '../lib/stock-table';
import { controlRequest } from './control-api';

export const FORMULA_RECIPES = [
  { label: 'Available = Physical − Reserved − Quarantine', name: 'Available', key: 'available', formula: 'max(0, physical - reserved - quarantine)', type: 'number' },
  { label: 'Variance % of book', name: 'Variance %', formula: 'if(book = 0, 0, round(variance / book * 100, 1))', type: 'number' },
  { label: 'Value per unit', name: 'Value per unit', formula: 'if(physical = 0, 0, round(value / physical, 2))', type: 'currency' },
  { label: 'Needs attention (1 = yes)', name: 'Needs attention', formula: 'if(physical - reserved - quarantine < 10, 1, 0)', type: 'number' },
];

const FUNCTION_BUTTONS = [['MAX', 'max('], ['MIN', 'min('], ['ROUND', 'round('], ['ABS', 'abs('], ['IF', 'if(']];
const OPERATORS = [['+', '+'], ['−', '-'], ['×', '*'], ['÷', '/'], ['(', '('], [')', ')']];
const SAMPLE_DEFAULTS = { physical: 100, book: 90, variance: 10, quarantine: 5, reserved: 20, value: 2500 };

export function insertAtCursor(text, insertion, start, end) {
  const from = Math.max(0, Math.min(start ?? text.length, text.length));
  const to = Math.max(from, Math.min(end ?? from, text.length));
  const before = text.slice(0, from);
  const isOperator = ['+', '-', '*', '/'].includes(insertion);
  const needsLeadingSpace = insertion !== ')' && before.length > 0 && !/[\s(]$/.test(before);
  const piece = `${needsLeadingSpace ? ' ' : ''}${insertion}${isOperator ? ' ' : ''}`;
  return { text: before + piece + text.slice(to), cursor: from + piece.length };
}

/** No-code calculated columns for the Stock table: pick fields, type a formula, see the result live. */
export function FormulaBuilder({ controlToken, onSaved }) {
  const [columns, setColumns] = useState([]);
  const [editing, setEditing] = useState(null); // { key?, name, formula, type }
  const [sample, setSample] = useState(SAMPLE_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const load = useCallback((draft) => setColumns((draft?.page?.columns ?? []).filter((column) => column.formula || column.key === 'available')), []);

  useEffect(() => {
    let cancelled = false;
    controlRequest('/studio/v1/draft', { token: controlToken })
      .then((result) => { if (!cancelled) load(result.draft); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load formulas'); });
    return () => { cancelled = true; };
  }, [controlToken, load]);

  const preview = useMemo(() => (editing ? checkStockFormula(editing.formula, sample) : null), [editing, sample]);

  function add(piece) {
    const input = inputRef.current;
    const { text, cursor } = insertAtCursor(editing.formula, piece, input?.selectionStart, input?.selectionEnd);
    setEditing({ ...editing, formula: text });
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(cursor, cursor); });
  }

  async function run(request, message) {
    setSaving(true);
    setError('');
    try {
      const result = await request();
      load(result.draft);
      setEditing(null);
      onSaved?.();
      toast.success(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const save = () => run(
    () => controlRequest('/studio/v1/draft/stock/formula-columns', { token: controlToken, method: 'PUT', body: { key: editing.key, label: editing.name, formula: editing.formula, type: editing.type } }),
    'Saved to draft. Open "Preview / publish" to make it live.',
  );
  const remove = (column) => run(
    () => controlRequest(`/studio/v1/draft/stock/formula-columns/${encodeURIComponent(column.key)}`, { token: controlToken, method: 'DELETE' }),
    column.source === 'formula' ? 'Column removed from draft.' : 'Back to the standard formula (in draft).',
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Calculator className="size-4" />Formulas (calculated columns)</CardTitle>
        <p className="text-xs text-muted-foreground">Create columns that are calculated for every stock row, or change how Available is worked out. Nothing here changes your actual stock numbers.</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          {columns.map((column) => (
            <div key={column.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <div>
                <p className="text-sm font-medium">{column.label} {column.source === 'formula' ? <Badge variant="outline">Calculated</Badge> : <Badge variant="secondary">Built-in</Badge>}</p>
                <p className="font-mono text-xs text-muted-foreground">{column.formula ?? 'Standard: physical − reserved − quarantine'}</p>
              </div>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ key: column.key, name: column.label, formula: column.formula ?? 'max(0, physical - reserved - quarantine)', type: column.type === 'currency' ? 'currency' : 'number' })}>Edit</Button>
                {column.formula && (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} aria-label={`${column.source === 'formula' ? 'Remove' : 'Reset'} ${column.label}`} onClick={() => remove(column)}>
                    {column.source === 'formula' ? <Trash2 className="size-4" /> : <RotateCcw className="size-4" />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing({ name: '', formula: '', type: 'number' })}><Plus className="size-4" />New calculated column</Button>
            {FORMULA_RECIPES.map((recipe) => (
              <Button key={recipe.label} type="button" size="sm" variant="ghost" onClick={() => setEditing({ key: recipe.key, name: recipe.name, formula: recipe.formula, type: recipe.type })}>{recipe.label}</Button>
            ))}
          </div>
        )}

        {editing && (
          <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <Input aria-label="Column name" placeholder="Column name, e.g. Free stock" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
              <select aria-label="Column type" className="h-9 rounded-md border bg-background px-2 text-sm" value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value })}>
                <option value="number">Number</option>
                <option value="currency">Money (₹)</option>
              </select>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Click to add a field</span>
              <div className="flex flex-wrap gap-1">
                {STOCK_FORMULA_FIELD_OPTIONS.map((field) => <Button key={field.key} type="button" size="sm" variant="outline" onClick={() => add(field.key)}>{field.label}</Button>)}
              </div>
              <div className="flex flex-wrap gap-1">
                {OPERATORS.map(([label, value]) => <Button key={label} type="button" size="sm" variant="secondary" aria-label={`Add ${label}`} onClick={() => add(value)}>{label}</Button>)}
                {FUNCTION_BUTTONS.map(([label, text]) => <Button key={label} type="button" size="sm" variant="ghost" title={text} onClick={() => add(text)}>{label}</Button>)}
              </div>
            </div>
            <Input ref={inputRef} aria-label="Formula" className="font-mono" placeholder="physical - reserved - quarantine" value={editing.formula} onChange={(event) => setEditing({ ...editing, formula: event.target.value })} />
            <div aria-live="polite" className={`rounded-md border p-2 text-sm ${preview?.ok ? 'border-primary/30 bg-primary/5' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
              {preview?.ok ? <>Result for the sample numbers: <strong>{formatStockFormulaValue(preview.value, editing.type)}</strong></> : preview?.error}
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Sample numbers for the preview</summary>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
                {STOCK_FORMULA_FIELD_OPTIONS.map((field) => (
                  <label key={field.key} className="grid gap-1">{field.label}
                    <Input type="number" value={sample[field.key]} onChange={(event) => setSample({ ...sample, [field.key]: Number(event.target.value) })} />
                  </label>
                ))}
              </div>
            </details>
            <div className="flex gap-2">
              <Button type="button" onClick={save} disabled={saving || !preview?.ok || !editing.name.trim()}><Save className="size-4" />{saving ? 'Saving…' : 'Save to draft'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setEditing(null); setError(''); }}>Cancel</Button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
