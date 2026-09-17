import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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

export function TransferImportDialog() {
  const {
    downloadImportErrors, locations, modalOpen, previewOrCommitTransferImport,
    setModalOpen, setTransferImportFile, setTransferImportForm, setTransferImportPreview,
    submitLoading, transferImportFile, transferImportForm, transferImportPreview,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'transferImport'} onOpenChange={(open) => { if (!open) { setModalOpen(null); setTransferImportFile(null); setTransferImportPreview(null); } }}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader><DialogTitle>Import transfer request</DialogTitle><DialogDescription>Map the request to exact item codes, validate warehouse stock and allocate expiry lots using FEFO before releasing it to the picker.</DialogDescription></DialogHeader>
          <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2"><Label>Source warehouse</Label><Select value={transferImportForm.sourceLocationId} onValueChange={(value) => { setTransferImportForm({ ...transferImportForm, sourceLocationId: value }); setTransferImportPreview(null); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{locations.filter((entry) => entry.type === 'warehouse').map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-2"><Label>Destination store</Label><Select value={transferImportForm.destinationLocationId} onValueChange={(value) => setTransferImportForm({ ...transferImportForm, destinationLocationId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{locations.filter((entry) => entry.type === 'store').map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid gap-2"><Label>Transfer Excel or CSV</Label><Input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { setTransferImportFile(event.target.files?.[0] || null); setTransferImportPreview(null); }} /><p className="text-xs text-muted-foreground">Required columns: Item Code or exact Item Name, and Requested Qty. Destination Store, Unit and Remarks are also supported.</p></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={transferImportForm.mergeDuplicates} onCheckedChange={(checked) => { setTransferImportForm({ ...transferImportForm, mergeDuplicates: checked === true }); setTransferImportPreview(null); }} />Merge duplicate item rows before FEFO allocation</label>
            {transferImportPreview && <div className="grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Validation preview</p><p className="text-xs text-muted-foreground">{transferImportPreview.sheetName} · header row {transferImportPreview.headerRow}</p></div><Badge variant={transferImportPreview.invalidRows ? 'destructive' : 'success'}>{transferImportPreview.invalidRows ? `${transferImportPreview.invalidRows} errors` : 'Ready for picker'}</Badge></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Rows', transferImportPreview.totalRows], ['Mapped', transferImportPreview.validRows], ['Invalid', transferImportPreview.invalidRows], ['Duplicates', transferImportPreview.duplicateRows]].map(([label, value]) => <div key={label} className="rounded-md border bg-background p-2"><p className="text-lg font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}</div>
              {transferImportPreview.rows?.length > 0 && <div className="overflow-x-auto rounded-md border bg-background"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Requested</TableHead><TableHead>FEFO lots</TableHead></TableRow></TableHeader><TableBody>{transferImportPreview.rows.slice(0, 8).map((row) => <TableRow key={`${row.rowNumber}-${row.itemId}`}><TableCell><p className="font-medium">{row.itemCode}</p><p className="text-xs text-muted-foreground">{row.itemName}</p></TableCell><TableCell>{row.requestedQty} {row.unit}</TableCell><TableCell className="text-xs">{row.allocations.map((lot) => `${lot.lotNo}: ${lot.quantity}`).join(', ')}</TableCell></TableRow>)}</TableBody></Table></div>}
              {transferImportPreview.errors?.length > 0 && <div className="max-h-32 overflow-y-auto rounded-md border bg-background p-2 text-xs">{transferImportPreview.errors.slice(0, 20).map((error) => <p key={`${error.rowNumber}-${error.message}`}><strong>Row {error.rowNumber}:</strong> {error.message}</p>)}</div>}
            </div>}
          </div>
          <DialogFooter>{transferImportPreview?.errors?.length > 0 && <Button type="button" variant="outline" onClick={() => downloadImportErrors(transferImportPreview, 'transfer')}>Download invalid rows CSV</Button>}<Button variant="outline" onClick={() => setModalOpen(null)}>Cancel</Button>{transferImportPreview && !transferImportPreview.invalidRows && <Button variant="outline" onClick={() => previewOrCommitTransferImport(false)} disabled={submitLoading}>Revalidate</Button>}<Button onClick={() => previewOrCommitTransferImport(Boolean(transferImportPreview && !transferImportPreview.invalidRows))} disabled={submitLoading || !transferImportFile || (transferImportPreview?.invalidRows > 0)}>{submitLoading ? 'Processing…' : transferImportPreview ? `Confirm ${transferImportPreview.validRows} rows` : 'Preview & validate'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
