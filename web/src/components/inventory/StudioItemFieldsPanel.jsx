import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/feedback-states';
import { StudioItemFieldInput } from './StudioItemFieldInput';

function display(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value ?? '—';
}

function FieldEditor({ field, save, reload }) {
  const [draft, setDraft] = useState(String(field.value ?? ''));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const change = (event) => { setDraft(event.target.value); setSaved(false); };
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const text = draft.trim();
    let value = text || null;
    if (text && field.type === 'number') value = Number(text);
    if (text && field.type === 'boolean') value = text === 'true';
    try {
      const result = await save(field.key, value);
      setDraft(String(result.value ?? ''));
      setSaved(true);
    } catch (error) {
      setError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="grid gap-2" onSubmit={submit}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-28 flex-1">
          <StudioItemFieldInput field={field} value={draft} onChange={change} disabled={saving} />
        </div>
        <Button size="sm" variant="outline" type="submit" aria-label={`Save ${field.label}`} disabled={saving || error?.status === 409}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error.message}</p>}
      {error?.status === 409 && <Button type="button" size="sm" variant="ghost" onClick={reload}>Reload item fields</Button>}
      {saved && <p className="text-sm text-muted-foreground" role="status">Saved</p>}
    </form>
  );
}

export function StudioItemFieldsPanel({ authToken, itemId }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const reload = () => setAttempt((current) => current + 1);
  const path = `/api/v1/items/${encodeURIComponent(itemId)}/studio-fields`;

  useEffect(() => {
    if (!authToken) return;
    const controller = new AbortController();
    apiRequest(path, { headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setResult({ attempt, path, authToken, data }); },
      (error) => { if (!controller.signal.aborted) setResult({ attempt, path, authToken, error }); },
    );
    return () => controller.abort();
  }, [attempt, path, authToken]);

  if (!authToken) return null;
  if (result?.attempt !== attempt || result.path !== path || result.authToken !== authToken) return <LoadingState label="Loading item fields…" />;
  if (result.error) return <ErrorState title="Could not load item fields" description={result.error.message} onRetry={reload} />;
  if (!result.data.fields?.length) return null;
  const { versionId, fields } = result.data;
  const save = (key, value) => apiRequest(`${path}/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ versionId, value }),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Item fields</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => field.editable ? (
          <FieldEditor key={`${versionId}:${field.key}`} field={field} save={save} reload={reload} />
        ) : (
          <dl key={field.key} className="grid content-start gap-2 text-sm"><dt className="font-medium">{field.label}</dt><dd>{display(field.value)}</dd></dl>
        ))}
      </CardContent>
    </Card>
  );
}
