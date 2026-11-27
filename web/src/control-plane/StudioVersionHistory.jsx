import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState, LoadingState } from '@/components/ui/feedback-states';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/workspace';
import { controlRequest } from './control-api';

function ReviewRestore({ controlToken, version, onClose, onRestored, onReload, restoreFocus }) {
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const reasonId = useId();
  const cancelRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    controlRequest(`/studio/v1/versions/${encodeURIComponent(version.id)}/compare`, { token: controlToken, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setComparison(result); })
      .catch((error) => { if (!controller.signal.aborted) setError(error); });
    return () => controller.abort();
  }, [controlToken, version.id]);

  async function restore(event) {
    event.preventDefault();
    if (saving || !comparison?.target.canRestore || !reason.trim() || error?.status === 409) return;
    setSaving(true);
    setError(null);
    try {
      const { published } = await controlRequest('/studio/v1/rollback', { token: controlToken, method: 'POST', body: {
        version: comparison.target.version, targetVersionId: comparison.target.id, expectedActiveVersionId: comparison.active.id, reason: reason.trim(),
      } });
      onRestored(comparison.target.version, published.version);
    } catch (error) {
      setError(error);
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent showCloseButton={false}
        onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <DialogHeader>
          <DialogTitle>Restore version {version.version}</DialogTitle>
          <DialogDescription>The restored settings become active as a new published version. The current draft and version history stay available.</DialogDescription>
        </DialogHeader>
        <form onSubmit={restore} className="grid gap-4">
          {!comparison && !error && <LoadingState label="Comparing versions…" className="min-h-16" />}
          {comparison && (
            <div className="space-y-2 text-sm">
              <p>Comparing active version {comparison.active.version} with version {comparison.target.version}.</p>
              {comparison.changes.length ? <ul aria-label="Configuration areas that will change" className="list-disc space-y-1 pl-5">
                {comparison.changes.map((name) => <li key={name}>{name}</li>)}
              </ul> : <p className="text-muted-foreground">The saved settings match the active version.</p>}
              {comparison.target.blockedReason && <p role="status" className="text-destructive">{comparison.target.blockedReason}</p>}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
          {comparison?.target.canRestore && <div className="grid gap-1.5">
            <Label htmlFor={reasonId}>Reason for restoring</Label>
            <Textarea id={reasonId} rows={3} required maxLength={500} value={reason} disabled={saving}
              onChange={(event) => setReason(event.target.value)} />
          </div>}
          <DialogFooter>
            <Button ref={cancelRef} type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            {error?.status === 409 || (!comparison && error) ? <Button type="button" variant="outline" onClick={onReload}>Reload versions</Button> : (
              <Button type="submit" disabled={saving || !reason.trim() || !comparison?.target.canRestore}>
                {saving ? 'Restoring…' : `Restore version ${version.version}`}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StudioVersionHistory({ controlToken, activeVersion, onRestored }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const returnFocus = useRef(null);
  const heading = useRef(null);
  const ready = result?.token === controlToken && result?.activeVersion === activeVersion && result?.attempt === attempt;

  useEffect(() => {
    if (!controlToken) return;
    const controller = new AbortController();
    const context = { token: controlToken, activeVersion, attempt };
    controlRequest('/studio/v1/versions', { token: controlToken, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult({ ...context, data }); })
      .catch((error) => { if (!controller.signal.aborted) setResult({ ...context, error }); });
    return () => controller.abort();
  }, [controlToken, activeVersion, attempt]);

  const reload = () => setAttempt((value) => value + 1);
  const versions = ready ? result.data?.versions ?? [] : [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base"><h2 ref={heading} tabIndex={-1}>Version history</h2></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {!ready && <LoadingState label="Loading versions…" className="min-h-16" />}
        {ready && result.error && <ErrorState title="Could not load version history" description={result.error.message} onRetry={reload} />}
        {ready && !result.error && versions.length === 0 && <p className="text-sm text-muted-foreground">No published versions are available.</p>}
        {versions.length > 0 && <ul className="max-h-72 divide-y overflow-y-auto" aria-label="Published versions">
          {versions.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Version {entry.version}</span>
                  {entry.id === result.data.active?.id && <Badge variant="outline">Active</Badge>}</div>
                <p className="text-xs text-muted-foreground">{entry.author} · {formatDateTime(entry.publishedAt)}</p>
                {entry.blockedReason && <p className="text-muted-foreground">{entry.blockedReason}</p>}
              </div>
              {entry.canRestore && <Button type="button" variant="outline" size="sm" onClick={(event) => {
                returnFocus.current = event.currentTarget;
                setSelected(entry);
              }}>Compare version {entry.version}</Button>}
            </li>
          ))}
        </ul>}
      </CardContent>
      {selected && <ReviewRestore controlToken={controlToken} version={selected} onClose={() => setSelected(null)}
        onReload={() => { setSelected(null); reload(); }} restoreFocus={() => {
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
          else heading.current?.focus();
        }} onRestored={(source, active) => {
          setNotice(`Version ${source} restored as version ${active}.`);
          setSelected(null);
          reload();
          onRestored?.();
        }} />}
    </Card>
  );
}
