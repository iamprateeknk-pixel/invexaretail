import { FileDropZone } from '../../imports/FileDropZone';
import { downloadCsvTemplate, OPENING_STOCK_TEMPLATE } from '../../../lib/import-templates';
import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download } from 'lucide-react';
import { ItemSearchSelect } from '../../ItemSearchSelect';
import { ImportControlCenter } from '../../imports/ImportControlCenter';
import { CounterBadges } from '../../imports/CounterBadges';

export function StockUpdatePage() {
  const {
        items, stockUpdateForm, setStockUpdateForm, stockRows, locations, submitManualStockUpdate,
    submitLoading, stockUpdateImportMode, setStockUpdateImportMode, stockUpdateFile, setStockUpdateFile,
    setStockUpdatePreview, stockUpdatePreview, downloadImportErrors, previewOrCommitStockUpdate,
    importBatches, reversePostedImport, role, authToken, liveRevision,
  } = useWorkspace();
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const selectedStockItem = items.find((item) => item.id === stockUpdateForm.itemId);
  const selectedStockLot = selectedStockItem?.lots?.find((lot) => lot.lotNo.toLowerCase() === stockUpdateForm.lotNo.toLowerCase());
  const selectedLedger = stockRows.find((row) => row.itemId === stockUpdateForm.itemId && (!selectedStockLot || row.lotId === selectedStockLot.id));
  return <div className="space-y-6">
    {['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(role) && <ImportControlCenter token={authToken} itemsById={itemsById} locationsById={locationsById} refreshKey={liveRevision} />}
    <Alert><AlertDescription>Every manual and Excel stock update is recorded in the audit trail. Use <strong>Set exact stock</strong> after a verified physical check, <strong>Add</strong> for unrecorded inward stock, and <strong>Remove</strong> for approved corrections.</AlertDescription></Alert>
    <div className="grid gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Manual lot stock update</CardTitle><p className="text-xs text-muted-foreground">Update one item and lot at the selected branch.</p></CardHeader><CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label>Location</Label><Select value={stockUpdateForm.locationId} onValueChange={(locationId) => setStockUpdateForm({ ...stockUpdateForm, locationId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Item</Label><ItemSearchSelect items={items} value={stockUpdateForm.itemId} onChange={(itemId) => { const item = items.find((entry) => entry.id === itemId); setStockUpdateForm({ ...stockUpdateForm, itemId, lotNo: item?.lots?.[0]?.lotNo ?? '' }); }} /></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label>Lot code</Label><Input list="stock-update-lots" value={stockUpdateForm.lotNo} onChange={(event) => setStockUpdateForm({ ...stockUpdateForm, lotNo: event.target.value })} placeholder="Existing or new lot code" /><datalist id="stock-update-lots">{selectedStockItem?.lots?.map((lot) => <option key={lot.id} value={lot.lotNo} />)}</datalist></div><div className="grid gap-2"><Label>Expiry date (new lot)</Label><Input type="date" aria-label="Expiry date for the new lot" value={stockUpdateForm.expiryDate} onChange={(event) => setStockUpdateForm({ ...stockUpdateForm, expiryDate: event.target.value })} /></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label>Update method</Label><Select value={stockUpdateForm.mode} onValueChange={(mode) => setStockUpdateForm({ ...stockUpdateForm, mode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SET">Set exact stock</SelectItem><SelectItem value="ADD">Add quantity</SelectItem><SelectItem value="REMOVE">Remove quantity</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>{stockUpdateForm.mode === 'SET' ? 'New exact quantity' : 'Quantity'}</Label><Input type="number" aria-label="New exact quantity" min="0" step="0.001" value={stockUpdateForm.quantity} onChange={(event) => setStockUpdateForm({ ...stockUpdateForm, quantity: event.target.value })} /></div></div>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm"><span className="text-muted-foreground">Current lot stock:</span> <strong>{selectedLedger?.bookQuantity ?? selectedLedger?.physicalQuantity ?? 0}</strong></div>
        <div className="grid gap-2"><Label>Reason</Label><Textarea value={stockUpdateForm.reason} onChange={(event) => setStockUpdateForm({ ...stockUpdateForm, reason: event.target.value })} placeholder="Physical verification, damaged stock, missed inward entry…" /></div>
        <Button onClick={submitManualStockUpdate} disabled={submitLoading || !stockUpdateForm.itemId || !stockUpdateForm.locationId || stockUpdateForm.quantity === '' || stockUpdateForm.reason.trim().length < 3}>{submitLoading ? 'Updating…' : 'Apply stock update'}</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Bulk lot-wise Excel update</CardTitle><p className="text-xs text-muted-foreground">Validated, duplicate-safe processing for 5,000+ branch/item/lot rows.</p></CardHeader><CardContent className="grid gap-4">
        <div className="grid gap-2"><Label>Update method for all rows</Label><Select value={stockUpdateImportMode} onValueChange={(mode) => { setStockUpdateImportMode(mode); setStockUpdatePreview(null); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SET">Set exact stock</SelectItem><SelectItem value="ADD">Add quantities</SelectItem><SelectItem value="REMOVE">Remove quantities</SelectItem></SelectContent></Select></div>
        <div className="grid gap-2"><Label>Excel or CSV file</Label><FileDropZone file={stockUpdateFile} onFile={(file) => { setStockUpdateFile(file); setStockUpdatePreview(null); }} /><div className="flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={() => downloadCsvTemplate('invexa-opening-stock-template.csv', OPENING_STOCK_TEMPLATE)}><Download className="size-4" />Download template</Button></div><p className="text-xs leading-5 text-muted-foreground">Columns: Branch Name, Item Code or exact Item Name, Lot Code, Quantity/Closing Stock. Company, Category, Sub Category, Pack/Size and Expiry Date are supported.</p></div>
        {stockUpdatePreview?.counters && <CounterBadges counters={stockUpdatePreview.counters} />}{stockUpdatePreview && <div className="grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"><div className="flex items-center justify-between"><p className="text-sm font-medium">Validation result{stockUpdatePreview.batchToken ? ` · ${stockUpdatePreview.status || 'PREVIEWED'}` : ''}</p><Badge variant={stockUpdatePreview.invalidRows ? 'destructive' : 'success'}>{stockUpdatePreview.invalidRows ? `${stockUpdatePreview.invalidRows} errors` : 'Ready'}</Badge></div><div className="grid grid-cols-3 gap-2">{[['Rows', stockUpdatePreview.totalRows], ['Ready', stockUpdatePreview.validRows], ['Duplicates', stockUpdatePreview.duplicateRows]].map(([label,value]) => <div key={label} className="rounded-md border bg-background p-2"><p className="font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}</div>{stockUpdatePreview.sample?.length > 0 && <div className="max-h-52 overflow-auto rounded-md border bg-background"><Table><TableHeader><TableRow><TableHead>Branch</TableHead><TableHead>Item / lot</TableHead><TableHead>Current</TableHead><TableHead>Change</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{stockUpdatePreview.sample.map((row) => <TableRow key={`${row.rowNumber}-${row.locationName}-${row.lotNo}`}><TableCell>{row.locationName}</TableCell><TableCell><p className="font-medium">{row.itemCode}</p><p className="text-xs text-muted-foreground">{row.lotNo}</p></TableCell><TableCell>{row.currentQty}</TableCell><TableCell>{row.qtyDelta}</TableCell><TableCell>{row.resultingQty}</TableCell></TableRow>)}</TableBody></Table></div>}{stockUpdatePreview.errors?.length > 0 && <><div className="max-h-28 overflow-auto rounded-md border bg-background p-2 text-xs">{stockUpdatePreview.errors.map((error) => <p key={`${error.rowNumber}-${error.message}`}><strong>Row {error.rowNumber || 'General'}:</strong> {error.message}</p>)}</div><Button type="button" variant="outline" onClick={() => downloadImportErrors(stockUpdatePreview, 'stock-update')}>Download invalid rows CSV</Button></>}</div>}
        <Button onClick={() => previewOrCommitStockUpdate(Boolean(stockUpdatePreview && !stockUpdatePreview.invalidRows))} disabled={submitLoading || !stockUpdateFile || (stockUpdatePreview?.invalidRows > 0)}>{submitLoading ? 'Processing…' : stockUpdatePreview ? `Confirm ${stockUpdatePreview.validRows} lot rows` : 'Preview & validate'}</Button>
      </CardContent></Card>
    </div>
    {['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(role) && <Card>
      <CardHeader><CardTitle className="text-base">Import history & recovery</CardTitle><p className="text-xs text-muted-foreground">Main Admin can reverse a posted opening-stock import. That removes the imported lot quantities so the file can be imported again with expiry dates.</p></CardHeader>
      <CardContent className="p-0">
        <Table><TableHeader><TableRow><TableHead>Imported</TableHead><TableHead>File / type</TableHead><TableHead>Rows</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>{importBatches.length ? importBatches.map((batch) => <TableRow key={batch.id}>
            <TableCell>{formatDateTime(batch.importedAt)}</TableCell>
            <TableCell><p className="font-medium">{batch.fileName}</p><p className="text-xs text-muted-foreground">{batch.type} · {batch.id}</p></TableCell>
            <TableCell>{batch.validRows}/{batch.totalRows}</TableCell>
            <TableCell><Badge variant={batch.status === 'REVERSED' ? 'secondary' : batch.status === 'POSTED' ? 'success' : 'outline'}>{batch.status}</Badge></TableCell>
            <TableCell className="text-right">{role === 'ADMIN' && (batch.reversible ?? (batch.status === 'POSTED' && !String(batch.type).endsWith('_REVERSAL'))) ? <Button size="sm" variant="destructive" disabled={submitLoading} onClick={() => reversePostedImport(batch)}>Reverse / remove</Button> : <span className="text-xs text-muted-foreground">Locked</span>}</TableCell>
          </TableRow>) : <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No database import batches found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>}
  </div>;
}
