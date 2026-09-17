import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function SmartFoldersCard({ token, tags, canManage }) {
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    setLoading(true); setError('');
    apiRequest('/api/v1/saved-views', { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (mounted.current) setViews(response.savedViews ?? []); })
      .catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load smart folders.'); })
      .finally(() => { if (mounted.current) setLoading(false); });
  }, [token, revision]);

  function toggleTag(tagId) {
    setSelectedTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]);
  }

  async function createView() {
    if (!name.trim()) return;
    try {
      await apiRequest('/api/v1/saved-views', {
        method: 'POST', headers,
        body: JSON.stringify({
          name: name.trim(),
          filter: {
            ...(category.trim() ? { category: category.trim() } : {}),
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(selectedTagIds.length ? { tagIds: selectedTagIds } : {}),
          },
        }),
      });
      if (mounted.current) { setName(''); setSearch(''); setCategory(''); setSelectedTagIds([]); setRevision((value) => value + 1); }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Smart folder was not created.');
    }
  }

  async function deleteView(viewId) {
    try {
      await apiRequest(`/api/v1/saved-views/${viewId}`, { method: 'DELETE', headers });
      if (mounted.current) setRevision((value) => value + 1);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to delete this smart folder.');
    }
  }

  async function openView(view) {
    try {
      const response = await apiRequest(`/api/v1/saved-views/${view.id}/items`, { headers });
      if (mounted.current) setPreview({ view, items: response.items ?? [] });
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load this smart folder.');
    }
  }

  return <Card>
    <CardHeader><CardTitle className="text-base">Smart folders</CardTitle><p className="text-xs text-muted-foreground">A saved filter re-run live against the catalog, not a static list.</p></CardHeader>
    <CardContent className="space-y-4">
      {canManage && <div className="grid gap-2 rounded-lg border p-3">
        <Input placeholder="Folder name" value={name} onChange={(event) => setName(event.target.value)} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Category (optional)" value={category} onChange={(event) => setCategory(event.target.value)} />
          <Input placeholder="Search text (optional)" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {tags.length > 0 && <div className="flex flex-wrap gap-2">
          {tags.map((tag) => <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)}>
            <Badge variant={selectedTagIds.includes(tag.id) ? 'default' : 'outline'}>{tag.name}</Badge>
          </button>)}
        </div>}
        <Button size="sm" onClick={createView} disabled={!name.trim()} className="justify-self-start">Save smart folder</Button>
      </div>}

      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}

      {loading ? <p role="status">Loading smart folders…</p> : !views.length ? <p className="text-sm text-muted-foreground">No smart folders saved yet.</p> : (
        <ul className="grid gap-2">
          {views.map((view) => <li key={view.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <button type="button" className="text-left text-sm font-medium hover:underline" onClick={() => openView(view)}>{view.name}</button>
            <div className="flex items-center gap-2">
              {view.isShared && <Badge variant="secondary">Shared</Badge>}
              {canManage && <Button size="sm" variant="ghost" onClick={() => deleteView(view.id)}>Delete</Button>}
            </div>
          </li>)}
        </ul>
      )}

      {preview && <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[80svh] overflow-y-auto">
          <DialogHeader><DialogTitle>{preview.view.name}</DialogTitle><DialogDescription>{preview.items.length} matching item{preview.items.length === 1 ? '' : 's'}</DialogDescription></DialogHeader>
          <ul className="grid gap-1.5">
            {preview.items.map((item) => <li key={item.id} className="rounded-md border p-2 text-sm">{item.code} · {item.name}</li>)}
            {!preview.items.length && <p className="py-6 text-center text-sm text-muted-foreground">No items match this folder right now.</p>}
          </ul>
        </DialogContent>
      </Dialog>}
    </CardContent>
  </Card>;
}
