import { FileDropZone } from '../../imports/FileDropZone';
import { downloadCsvTemplate, OPENING_STOCK_TEMPLATE } from '../../../lib/import-templates';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Download } from 'lucide-react';

export function OpeningStockImportDialog() {
  const {
    downloadImportErrors, importFile, importItems, importPreview, modalOpen, setImportFile, setImportPreview,
    setModalOpen, submitLoading,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'import'} onOpenChange={(open) => { if (!open) { setModalOpen(null); setImportFile(null); setImportPreview(null); } }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import Opening Stock</DialogTitle>
            <DialogDescription>Upload your ERP expiry-stock Excel sheet. Invexa detects its title/header rows, validates every line, and asks for confirmation before changing stock.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Select Excel or CSV file</Label>
              <FileDropZone file={importFile} onFile={(file) => { setImportFile(file); setImportPreview(null); }} />
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => downloadCsvTemplate('invexa-opening-stock-template.csv', OPENING_STOCK_TEMPLATE)}>
                  <Download className="size-4" />Download template
                </Button>
              </div>
            </div>
            {importFile && <p className="text-sm text-muted-foreground">File selected: {importFile.name}</p>}
            {!importPreview && <div className="rounded-lg border bg-muted/50 p-3 text-xs leading-5">
              <p className="font-medium">Supported ERP columns</p>
              <p>COMPANY NAME · BRANCH NAME · CATEGORY · SUB CATEGORY · ITEM CODE · ITEM NAME · PACK/SIZE · BATCH · LOT CODE · EXPIRY DATE · CLOSING STOCK · purchase/sale closing value</p>
              <p className="mt-2 text-muted-foreground">The older Code, Name, Category, Unit CSV format also remains supported.</p>
            </div>}
            {importPreview && <div className="grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-medium">Preview ready{importPreview.batchToken ? ` · ${importPreview.status || 'PREVIEWED'}` : ''}</p><p className="text-xs text-muted-foreground">{importPreview.sheetName} · header row {importPreview.headerRow} · {importPreview.format === 'invexa-expiry-stock' ? 'ERP opening stock' : 'Standard items'}</p></div>
                <Badge variant={importPreview.invalidRows ? 'destructive' : 'success'}>{importPreview.invalidRows ? `${importPreview.invalidRows} need attention` : 'Validated'}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[['Total rows', importPreview.totalRows], ['Valid', importPreview.validRows], ['Invalid', importPreview.invalidRows], ['Duplicate rows', importPreview.duplicateRows]].map(([label, value]) => <div key={label} className="rounded-md border bg-background p-2"><p className="text-lg font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}
              </div>
              <div className="text-xs text-muted-foreground">
                <p><span className="font-medium text-foreground">Branches:</span> {importPreview.branches?.join(', ') || 'Items only'}</p>
                <p><span className="font-medium text-foreground">Special quantities:</span> {importPreview.fractionalQuantityRows} fractional · {importPreview.negativeQuantityRows} negative (kept exactly)</p>
              </div>
              {importPreview.errors?.length > 0 && <><div className="max-h-28 overflow-auto rounded-md border bg-background p-2 text-xs">{importPreview.errors.slice(0, 8).map((error) => <p key={`${error.rowNumber}-${error.message}`}><span className="font-medium">Row {error.rowNumber}:</span> {error.message}</p>)}</div><Button type="button" variant="outline" onClick={() => downloadImportErrors(importPreview, 'opening-stock')}>Download invalid rows CSV</Button></>}
              <Alert><AlertDescription>Confirming creates an immutable opening snapshot and replaces current stock only for the matching branch + item + lot. Invalid rows are skipped.</AlertDescription></Alert>
            </div>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setModalOpen(null); setImportFile(null); setImportPreview(null); }}>Cancel</Button>
            <Button type="button" onClick={importItems} disabled={submitLoading}>{submitLoading ? (importPreview ? 'Importing…' : 'Validating…') : (importPreview ? `Confirm ${importPreview.validRows} valid rows` : 'Preview & Validate')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
