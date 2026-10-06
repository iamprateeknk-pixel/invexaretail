import { useState } from 'react'
import { useBundle } from '@/hooks/useBundle'
import { useItemSearch } from '@/hooks/useItemSearch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, LoadingState } from '@/components/ui/feedback-states'

// A bundle (kit) owns no stock: how many can be sold is the number of whole
// kits its scarcest component allows. Admins edit the component list here.
export function BundlePanel({ authToken, itemId, canEdit }) {
  const { bundle, loading, saving, error, save, remove } = useBundle({ authToken, itemId });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const { query, setQuery, items } = useItemSearch({ authToken: editing ? authToken : null, pageSize: 5 });

  if (loading && !bundle) return <LoadingState label="Loading bundle…" />;
  if (error && !bundle) return <ErrorState description={error} />;
  if (!bundle) return null;

  const startEdit = () => {
    setDraft(bundle.components.map((c) => ({ itemId: c.itemId, name: c.name, quantity: c.quantity })));
    setEditing(true);
  };
  const addComponent = (item) => {
    if (item.id === itemId || draft.some((c) => c.itemId === item.id)) return;
    setDraft([...draft, { itemId: item.id, name: item.name, quantity: 1 }]);
    setQuery('');
  };
  const setQuantity = (id, value) => setDraft(draft.map((c) => (c.itemId === id ? { ...c, quantity: value } : c)));
  const onSave = async () => {
    const ok = await save(draft.map((c) => ({ itemId: c.itemId, quantity: Number(c.quantity) })));
    if (ok) setEditing(false);
  };

  const limiting = bundle.components.find((c) => c.itemId === bundle.limitingItemId);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Bundle / kit</CardTitle>
        {canEdit && !editing && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={startEdit}>{bundle.isBundle ? 'Edit' : 'Make a bundle'}</Button>
            {bundle.isBundle && <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={remove}>Remove</Button>}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!editing && !bundle.isBundle && <p className="text-sm text-muted-foreground">This item is not a bundle.</p>}
        {!editing && bundle.isBundle && (
          <>
            <p className="text-2xl font-bold">{bundle.buildable} <span className="text-sm font-normal text-muted-foreground">can be built</span></p>
            {limiting && <p className="text-xs text-muted-foreground">Limited by {limiting.name}.</p>}
            <ul className="divide-y text-sm">
              {bundle.components.map((c) => (
                <li key={c.itemId} className="flex items-center justify-between py-1.5"><span>{c.name}</span><Badge variant="secondary">× {c.quantity}</Badge></li>
              ))}
            </ul>
          </>
        )}
        {editing && (
          <>
            <ul className="divide-y text-sm">
              {draft.map((c) => (
                <li key={c.itemId} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">{c.name}</span>
                  <span className="flex items-center gap-1">
                    <Input aria-label={`Quantity of ${c.name}`} type="number" min="0.001" step="any" value={c.quantity} onChange={(e) => setQuantity(c.itemId, e.target.value)} className="h-8 w-20" />
                    <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => setDraft(draft.filter((x) => x.itemId !== c.itemId))}>✕</Button>
                  </span>
                </li>
              ))}
            </ul>
            <Input aria-label="Search items to add" placeholder="Search an item to add…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query.trim() && items.length > 0 && (
              <ul aria-label="Matching items" className="divide-y rounded-md border text-sm">
                {items.slice(0, 5).map((item) => (
                  <li key={item.id}><button type="button" className="flex w-full justify-between px-3 py-2 text-left hover:bg-accent" onClick={() => addComponent(item)}><span>{item.name}</span><span className="text-muted-foreground">{item.code}</span></button></li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="button" disabled={saving || draft.length === 0} onClick={onSave}>Save bundle</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
