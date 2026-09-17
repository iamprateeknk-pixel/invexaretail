import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';

export function BulkCountDialog() {
  const {
    assignBulkCount, bulkCountForm, bulkCountPreview, items,
    locations, modalOpen, previewBulkCount, setBulkCountFile,
    setBulkCountForm, setBulkCountPreview, setModalOpen, storeUsers,
    submitLoading,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'bulkCount'} onOpenChange={(open) => { if (!open) { setModalOpen(null); setBulkCountPreview(null); setBulkCountFile(null); } }}>
        <DialogContent className="w-[calc(100%-1rem)] max-h-[92vh] sm:max-w-5xl">
          <DialogHeader><DialogTitle>Bulk stock take assignment</DialogTitle><DialogDescription>Use Category, Sub Category and Company together. Only items with positive stock at the selected store are assignable.</DialogDescription></DialogHeader>
          <div className="grid max-h-[68vh] gap-4 overflow-y-auto pr-1">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="grid gap-1.5"><Label>Store</Label><Select value={bulkCountForm.locationId} onValueChange={(value) => { setBulkCountForm({ ...bulkCountForm, locationId: value, selectedItemIds: [] }); setBulkCountPreview(null); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{locations.filter((entry) => entry.type === 'store').map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>Store user</Label><Select value={bulkCountForm.storeUserId || undefined} onValueChange={(value) => setBulkCountForm({ ...bulkCountForm, storeUserId: value })}><SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger><SelectContent>{storeUsers.filter((user) => user.assignedLocationIds?.includes(bulkCountForm.locationId)).map((user) => <SelectItem key={user.id} value={user.id}>{user.name ?? user.email}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>Due date</Label><Input type="date" value={bulkCountForm.dueDate} onChange={(event) => setBulkCountForm({ ...bulkCountForm, dueDate: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label>Priority</Label><Select value={bulkCountForm.priority} onValueChange={(value) => setBulkCountForm({ ...bulkCountForm, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="LOW">Low</SelectItem><SelectItem value="NORMAL">Normal</SelectItem><SelectItem value="HIGH">Urgent</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>Search item</Label><Input value={bulkCountForm.search} onChange={(event) => setBulkCountForm({ ...bulkCountForm, search: event.target.value })} placeholder="Code or name" /></div>
              {[['category', 'Category', 'categories'], ['subcategory', 'Sub Category', 'subcategories'], ['company', 'Company', 'companies']].map(([field, label, values]) => <div key={field} className="grid gap-1.5"><Label>{label}</Label><Select value={bulkCountForm[field]} onValueChange={(value) => setBulkCountForm({ ...bulkCountForm, [field]: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{(bulkCountPreview?.filters?.[values] ?? [...new Set(items.map((item) => item[field]).filter(Boolean))]).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>)}
            </div>
            <div className="grid gap-1.5 rounded-lg border border-dashed p-3"><Label>Optional item-list import</Label><Input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { setBulkCountFile(event.target.files?.[0] || null); setBulkCountPreview(null); }} /><p className="text-xs text-muted-foreground">If selected, Item Code / Item Name rows from this file are used instead of filters. Unknown and zero-stock items are reported and excluded.</p></div>
            <div><Button variant="outline" onClick={previewBulkCount} disabled={submitLoading || !bulkCountForm.locationId}>Preview matching stock</Button></div>
            {bulkCountPreview && <div className="grid gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm"><strong>{bulkCountPreview.matchingCount}</strong> eligible · {bulkCountPreview.excludedZeroStock} zero-stock excluded</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setBulkCountForm({ ...bulkCountForm, selectedItemIds: bulkCountPreview.items.map((item) => item.id) })}>Select all</Button><Button size="sm" variant="outline" onClick={() => setBulkCountForm({ ...bulkCountForm, selectedItemIds: [] })}>Clear</Button></div></div>
              <div className="max-h-72 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead className="w-12" /><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Sub Category</TableHead><TableHead>Company</TableHead><TableHead>Available</TableHead></TableRow></TableHeader><TableBody>{bulkCountPreview.items.map((item) => <TableRow key={item.id}><TableCell><Checkbox checked={bulkCountForm.selectedItemIds.includes(item.id)} onCheckedChange={(checked) => setBulkCountForm((current) => ({ ...current, selectedItemIds: checked ? [...new Set([...current.selectedItemIds, item.id])] : current.selectedItemIds.filter((id) => id !== item.id) }))} /></TableCell><TableCell><p className="font-medium">{item.code}</p><p className="text-xs text-muted-foreground">{item.name}</p></TableCell><TableCell>{item.category || '—'}</TableCell><TableCell>{item.subcategory || '—'}</TableCell><TableCell>{item.company || '—'}</TableCell><TableCell>{item.availableStock}</TableCell></TableRow>)}</TableBody></Table></div>
            </div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setModalOpen(null)}>Cancel</Button><Button onClick={assignBulkCount} disabled={submitLoading || !bulkCountForm.storeUserId || !bulkCountForm.selectedItemIds.length}>{submitLoading ? 'Assigning…' : `Assign ${bulkCountForm.selectedItemIds.length} items`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
