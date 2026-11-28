import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function StudioReleaseReview({ authToken }) {
  const [review, setReview] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('/api/v1/studio-release-review', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setReview(result.review);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('/api/v1/studio-release-review', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ reviewId: review.id, revision: review.revision }),
      });
      setReview({ ...review, approvedAt: result.approvedAt });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return <Card>
    <CardHeader><CardTitle className="text-base">Studio release review</CardTitle></CardHeader>
    <CardContent className="grid gap-4">
      <Button className="w-fit" type="button" variant="outline" disabled={busy} onClick={open}>
        {review === undefined ? 'Check assigned review' : 'Refresh assigned review'}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {review === null && <p role="status" className="text-sm text-muted-foreground">No Studio draft is assigned to you for review.</p>}
      {review && <>
        <p className="text-sm font-medium">Draft version {review.version}</p>
        {review.changes.length === 0 && <p className="text-sm text-muted-foreground">This draft has no configuration changes.</p>}
        {review.changes.map((change) => <details key={change.area} className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">{change.area}</summary>
          <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
            <div className="min-w-0"><h4 className="text-sm font-medium">Published</h4><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(change.before, null, 2)}</pre></div>
            <div className="min-w-0"><h4 className="text-sm font-medium">Proposed</h4><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(change.after, null, 2)}</pre></div>
          </div>
        </details>)}
        {review.approvedAt ? <p role="status" className="text-sm text-muted-foreground">Approved. A Studio operator can now publish this draft.</p>
          : <Button className="w-fit" type="button" disabled={busy} onClick={approve}>Approve this draft</Button>}
      </>}
    </CardContent>
  </Card>;
}
