import { useItemFieldValues, usesItemFields } from '../../../hooks/useItemFieldValues';
import { itemLotCellText, itemLotColumns } from '../../../lib/item-lot-table';
import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Camera, Hash, IndianRupee, Pencil, Printer, TrendingUp } from 'lucide-react';

export function ItemDetailsDialog() {
  const {
    canViewSystemStock, commentDraft, customFields, itemCatalogMeta,
    itemComments, itemFieldDrafts, items, locationId,
    locations, modalOpen, postItemComment, printItemLabel,
    reorderDraft, role, saveItemCustomField, saveReorderRule,
    selectedItem, setCommentDraft, setItemFieldDrafts, setModalOpen,
    setPhotoItem, setReorderDraft, setSerialItem, setForecastItem, setPricingItem, setMasterDialog, submitLoading, tags, toggleItemTag,
    runtimeConfig, authToken,
  } = useWorkspace();
  const lotColumns = itemLotColumns(runtimeConfig?.page, { role });
  const itemFieldValues = useItemFieldValues({ authToken, enabled: modalOpen === 'itemDetails' && usesItemFields(lotColumns) });
  return (
    <Dialog open={modalOpen === 'itemDetails'} onOpenChange={(open) => !open && setModalOpen(null)}>
        <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Item Details</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="grid gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{selectedItem.itemName}</p>
                  <p className="text-xs text-muted-foreground">SKU: {items.find((item) => item.id === selectedItem.itemId)?.code ?? selectedItem.itemId}</p>
                </div>
                <div className="flex gap-2">
                  {['ADMIN', 'ADMIN_USER'].includes(role) && <Button type="button" size="sm" variant="outline" onClick={() => { const item = items.find((entry) => entry.id === selectedItem.itemId); if (item) setMasterDialog({ mode: 'edit', item }); }}><Pencil className="size-4" />Edit master</Button>}
                  <Button type="button" size="sm" variant="outline" onClick={() => { const item = items.find((entry) => entry.id === selectedItem.itemId); if (item) setPhotoItem(item); }}><Camera className="size-4" />Photos</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => { const item = items.find((entry) => entry.id === selectedItem.itemId); if (item) setSerialItem(item); }}><Hash className="size-4" />Serials</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => { const item = items.find((entry) => entry.id === selectedItem.itemId); if (item) setForecastItem(item); }}><TrendingUp className="size-4" />Forecast</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => { const item = items.find((entry) => entry.id === selectedItem.itemId); if (item) setPricingItem(item); }}><IndianRupee className="size-4" />Pricing</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => printItemLabel(selectedItem)}><Printer className="size-4" />Print label</Button>
                </div>
              </div>
              {(() => { const item = items.find((entry) => entry.id === selectedItem.itemId); return <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/25 p-3 text-sm sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Company</p><p className="font-medium">{item?.company || '—'}</p></div><div><p className="text-xs text-muted-foreground">Category</p><p className="font-medium">{item?.category || '—'}</p></div><div><p className="text-xs text-muted-foreground">Sub Category</p><p className="font-medium">{item?.subcategory || '—'}</p></div><div><p className="text-xs text-muted-foreground">Pack/Size</p><p className="font-medium">{item?.unit || '—'}</p></div></div>; })()}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Physical: <strong>{selectedItem.physicalQuantity}</strong></div>
                {canViewSystemStock && <div>Book: <strong>{selectedItem.bookQuantity ?? 0}</strong></div>}
                {canViewSystemStock && (
                  <div>
                    Variance:{' '}
                    <strong className={Number(selectedItem.variance ?? 0) < 0 ? 'text-destructive' : 'text-success'}>
                      {selectedItem.variance ?? 0}
                    </strong>
                  </div>
                )}
                {canViewSystemStock && <div>Value: <strong>₹{selectedItem.stockValue ?? 0}</strong></div>}
              </div>
              {selectedItem.lots && selectedItem.lots.length > 0 && (
                <div>
                  <p className="mb-2 font-medium">Lot Details</p>
                  <div className="space-y-1 text-sm">
                    {selectedItem.lots.map((lot) => (
                      <div key={lot.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-2">
                        <div>
                          {lotColumns.filter((column) => column.key !== 'print').map((column, index) => {
                            if (column.key === 'status') return lot.status ? <Badge key={column.key} className="mt-1 mr-1" variant={lot.status === 'AVAILABLE' ? 'success' : 'warning'}>{lot.status}</Badge> : null;
                            const text = itemLotCellText(column, lot, { itemFieldValues, itemId: selectedItem.itemId ?? selectedItem.id });
                            return index === 0
                              ? <p key={column.key} className="font-medium">{text}</p>
                              : <p key={column.key} className="text-xs text-muted-foreground">{column.label}: {text}</p>;
                          })}
                        </div>
                        <Button type="button" size="sm" variant="ghost" onClick={() => printItemLabel(selectedItem, lot)}><Printer className="size-4" /><span className="sr-only">Print lot label</span></Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Separator />
              <div>
                <p className="mb-2 font-medium">Low-stock rule · {locations.find((location) => location.id === locationId)?.name}</p>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><div className="grid gap-1.5"><Label htmlFor="reorder-min">Alert below</Label><Input id="reorder-min" type="number" min="0" value={reorderDraft.minQty} disabled={role !== 'ADMIN'} onChange={(event) => setReorderDraft({ ...reorderDraft, minQty: Number(event.target.value) })} /></div><div className="grid gap-1.5"><Label htmlFor="reorder-target">Reorder target</Label><Input id="reorder-target" type="number" min={reorderDraft.minQty} value={reorderDraft.targetQty} disabled={role !== 'ADMIN'} onChange={(event) => setReorderDraft({ ...reorderDraft, targetQty: Number(event.target.value) })} /></div><Button type="button" variant="outline" disabled={role !== 'ADMIN' || submitLoading || Number(reorderDraft.targetQty) < Number(reorderDraft.minQty)} onClick={saveReorderRule}>Save rule</Button></div>
              </div>
              <Separator />
              <div>
                <p className="mb-2 font-medium">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {tags.length ? tags.map((tag) => {
                    const active = itemCatalogMeta.tags.some((selectedTag) => selectedTag.id === tag.id);
                    return <Button key={tag.id} type="button" size="sm" variant={active ? 'default' : 'outline'} disabled={role !== 'ADMIN' || submitLoading} onClick={() => toggleItemTag(tag.id)}>{tag.name}</Button>;
                  }) : <p className="text-xs text-muted-foreground">No catalogue tags configured.</p>}
                </div>
              </div>
              <div>
                <p className="mb-2 font-medium">Custom fields</p>
                <div className="grid gap-3">
                  {customFields.length ? customFields.map((field) => <div key={field.id} className="grid gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-center"><Label htmlFor={`custom-${field.id}`}>{field.name}</Label><Input id={`custom-${field.id}`} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={itemFieldDrafts[field.id] ?? ''} disabled={role !== 'ADMIN'} onChange={(event) => setItemFieldDrafts({ ...itemFieldDrafts, [field.id]: event.target.value })} /><Button size="sm" variant="outline" disabled={role !== 'ADMIN' || submitLoading} onClick={() => saveItemCustomField(field.id)}>Save</Button></div>) : <p className="text-xs text-muted-foreground">No custom fields configured.</p>}
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <div><p className="font-medium">Comments & mentions</p><p className="text-xs text-muted-foreground">Use @name to flag a teammate in the audit-ready discussion.</p></div>
                <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">{itemComments.length ? itemComments.map((comment) => <div key={comment.id} className="rounded-md bg-background p-2 shadow-sm"><div className="flex justify-between gap-3"><p className="text-xs font-semibold">{comment.authorName}</p><p className="text-[11px] text-muted-foreground">{formatDateTime(comment.createdAt)}</p></div><p className="mt-1 text-sm">{comment.body}</p></div>) : <p className="py-4 text-center text-xs text-muted-foreground">No comments yet.</p>}</div>
                <div className="flex gap-2"><Input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') postItemComment(); }} placeholder="Add a comment or @mention" /><Button type="button" variant="outline" onClick={postItemComment} disabled={!commentDraft.trim()}>Post</Button></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
  );
}
