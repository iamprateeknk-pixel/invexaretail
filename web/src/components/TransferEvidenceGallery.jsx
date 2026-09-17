import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function TransferEvidenceGallery({ transfer, token, apiBase, canUpload, onClose }) {
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const endpoint = apiBase + '/api/v1/transfers/' + encodeURIComponent(transfer.id) + '/evidence';
  useEffect(() => {
    const abort = new AbortController();
    const urls = [];
    setLoading(true);
    setError('');
    (async () => {
      try {
        const headers = { Authorization: 'Bearer ' + token };
        const response = await fetch(endpoint, { headers, signal: abort.signal });
        if (!response.ok) throw new Error('Unable to load transfer photos. Please retry.');
        const data = await response.json();
        const loaded = [];
        // Keep only one full-sized download in flight to limit memory pressure.
        for (const entry of data.evidence ?? []) {
          const file = await fetch(endpoint + '/' + encodeURIComponent(entry.id), { headers, signal: abort.signal });
          if (!file.ok) throw new Error('A saved photo could not be downloaded.');
          const blob = await file.blob();
          if (abort.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          loaded.push({ ...entry, url });
        }
        if (!abort.signal.aborted) setPhotos(loaded);
      } catch (err) {
        if (!abort.signal.aborted) setError(err.message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => { abort.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [endpoint, token, revision]);

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Select a JPEG, PNG or WebP photo up to 5 MB.');
      return;
    }
    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.append('evidence', file);
      const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Photo was not saved. Retry the upload.');
      if (mounted.current) setRevision((value) => value + 1);
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>Transfer photos</DialogTitle><DialogDescription>{transfer.id} · {transfer.fromName} → {transfer.toName}</DialogDescription></DialogHeader>
      {canUpload && <label className="grid gap-2 text-sm font-medium">Add carton or receiving photo
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || loading} onChange={upload} className="rounded-lg border p-3" />
        <span className="text-xs text-muted-foreground">{busy ? 'Saving photo…' : 'JPEG, PNG or WebP · up to 5 MB per photo'}</span>
      </label>}
      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error} <Button variant="outline" size="sm" disabled={busy || loading} onClick={() => setRevision((value) => value + 1)}>Retry loading</Button></div>}
      {loading ? <p role="status">Loading saved photos…</p> : !error && !photos.length ? <p className="py-8 text-center text-muted-foreground">No photos saved for this transfer.</p> : !error && <div className="grid gap-4 sm:grid-cols-2">
        {photos.map((photo) => <figure key={photo.id} className="overflow-hidden rounded-xl border">
          <img src={photo.url} alt={photo.fileName} className="h-48 w-full object-contain bg-muted" />
          <figcaption className="space-y-2 p-3"><p className="truncate text-sm">{photo.fileName}</p><a href={photo.url} download={photo.fileName} className="text-sm font-medium text-primary underline">Download photo</a></figcaption>
        </figure>)}
      </div>}
    </DialogContent>
  </Dialog>;
}
