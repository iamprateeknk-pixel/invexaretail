import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { diffEntries } from './studio-catalog';

// One Simple / Advanced switch for the whole Control Plane. Simple shows only
// plain-language choices; Advanced also shows technical keys and raw settings.
const STORAGE_KEY = 'invexa.control.mode';
const StudioModeContext = createContext({ advanced: false, setAdvanced: () => {} });

function readMode() {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) === 'advanced'; } catch { return false; }
}

export function StudioModeProvider({ children, initialAdvanced }) {
  const [advanced, setAdvancedState] = useState(() => initialAdvanced ?? readMode());
  const setAdvanced = useCallback((value) => {
    setAdvancedState(value);
    try { globalThis.localStorage?.setItem(STORAGE_KEY, value ? 'advanced' : 'simple'); } catch { /* per-viewer convenience only */ }
  }, []);
  const value = useMemo(() => ({ advanced, setAdvanced }), [advanced, setAdvanced]);
  return <StudioModeContext.Provider value={value}>{children}</StudioModeContext.Provider>;
}

export function useStudioMode() {
  return useContext(StudioModeContext);
}

export function ModeSwitch() {
  const { advanced, setAdvanced } = useStudioMode();
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-background p-1" role="group" aria-label="Simple or advanced settings">
      <Button type="button" size="sm" variant={advanced ? 'ghost' : 'default'} aria-pressed={!advanced} onClick={() => setAdvanced(false)}>Simple</Button>
      <Button type="button" size="sm" variant={advanced ? 'default' : 'ghost'} aria-pressed={advanced} onClick={() => setAdvanced(true)}>Advanced</Button>
    </div>
  );
}

/** Technical settings: rendered only in Advanced mode. */
export function Advanced({ children, label = 'Advanced' }) {
  const { advanced } = useStudioMode();
  if (!advanced) return null;
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3 md:col-span-full">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Honest marker for settings the operating app does not act on yet. */
export function NotLiveNote({ children }) {
  return (
    <p className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
      {children ?? 'Saved and published with your settings, but the app does not act on these yet.'}
    </p>
  );
}

/**
 * The shared list editor every Studio tab uses (same shape as Import columns):
 * a plain description, a live summary, one editable card per entry, Add,
 * Save changes and Discard. Saving sends only what changed: upserts for new
 * or edited entries, deletes for removed ones. Changes land in the draft and
 * go live on Publish.
 */
export function StudioListEditor(props) {
  // Remount on new saved data so the edit list restarts from what the server now holds.
  return <StudioListEditorBody key={JSON.stringify(props.entries)} {...props} />;
}

function StudioListEditorBody({
  title, description, entries, idOf, newEntry, renderEntry, summarize, save, remove, onSaved, addLabel = 'Add', emptyText = 'Nothing here yet.', notLive, canAdd = true, canRemove = () => true,
}) {
  const [items, setItems] = useState(entries);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { upserts, removals } = diffEntries(entries, items, idOf);
  const dirty = upserts.length > 0 || removals.length > 0;

  const update = (index, patch) => setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  async function saveAll() {
    setSaving(true);
    setError('');
    try {
      for (const id of removals) await remove(id);
      for (const entry of upserts) await save(entry, entries.some((saved) => idOf(saved) === idOf(entry)));
      await onSaved?.();
      toast.success('Saved to draft. Publish to make it live.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge variant={dirty ? 'warning' : 'secondary'}>{dirty ? 'Unsaved changes' : `${items.length} saved`}</Badge>
      </CardHeader>
      <CardContent className="grid gap-3">
        {notLive && <NotLiveNote>{typeof notLive === 'string' ? notLive : undefined}</NotLiveNote>}
        {summarize && items.length > 0 && (
          <ul className="grid gap-1 rounded-md border bg-muted/40 p-3 text-xs" aria-label={`${title} summary`}>
            {items.map((item, index) => <li key={index}>{summarize(item)}</li>)}
          </ul>
        )}
        {items.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
        {items.map((item, index) => (
          // Index keys: an entry's id can change while a new one is being named.
          <div key={index} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_auto]">
            <div className="grid gap-3">{renderEntry(item, (patch) => update(index, patch), {
              isNew: !entries.some((saved) => idOf(saved) === idOf(item)),
              others: items.filter((_, i) => i !== index),
            })}</div>
            {canRemove(item) && (
              <div className="flex justify-end">
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${item.name ?? item.label ?? idOf(item)}`} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {canAdd && <Button type="button" variant="outline" onClick={() => setItems((current) => [...current, newEntry(current)])}><Plus className="size-4" />{addLabel}</Button>}
          <Button type="button" onClick={saveAll} disabled={saving || !dirty}><Save className="size-4" />{saving ? 'Saving…' : 'Save changes'}</Button>
          <Button type="button" variant="ghost" onClick={() => setItems(entries)} disabled={saving || !dirty}><RotateCcw className="size-4" />Discard</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** A labelled native select: works in tests and on phones without extra wiring. */
export function Choice({ label, value, options, onChange, className = '' }) {
  return (
    <label className={`grid gap-1 text-xs ${className}`}>
      <span className="font-medium text-muted-foreground">{label}</span>
      <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

/** Toggle chips for picking several values in order. */
export function ChipPicker({ label, options, value, onChange }) {
  return (
    <div className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((option) => {
          const on = value.includes(option.value);
          return (
            <Button key={option.value} type="button" size="sm" variant={on ? 'default' : 'outline'} aria-pressed={on}
              onClick={() => onChange(on ? value.filter((entry) => entry !== option.value) : [...value, option.value])}>
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
