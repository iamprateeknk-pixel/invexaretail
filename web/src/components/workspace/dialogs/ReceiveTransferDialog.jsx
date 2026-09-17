import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ReceiveTransferDialog() {
  const {
    items, modalOpen, receiveForm, receivingTransfer,
    setModalOpen, setReceiveForm, submitLoading, submitTransferReceipt,
    updateReceiptLine, qcTemplates,
  } = useWorkspace();
  const activeTemplates = (qcTemplates ?? []).filter((template) => template.active !== false);
  const defaultChecks = [
    { key: 'SEAL_INTACT', label: 'Seal intact' },
    { key: 'PACKAGING_INTACT', label: 'Packaging intact' },
    { key: 'WEIGHT_MATCH', label: 'Weight matches expected' },
    { key: 'NO_MOISTURE_DAMAGE', label: 'No moisture damage' },
    { key: 'WITHIN_EXPIRY_WINDOW', label: 'Within expiry window' },
  ];

  function checksForLine(line) {
    const item = items.find((entry) => entry.id === line.itemId);
    const match = activeTemplates.find((template) => template.category && template.category === item?.category)
      || activeTemplates.find((template) => !template.category)
      || null;
    return match ? { template: match, checks: match.checks?.length ? match.checks : defaultChecks } : null;
  }

  function setQcResult(index, key, value) {
    setReceiveForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index
        ? { ...line, qcResults: { ...(line.qcResults || {}), [key]: value } }
        : line),
    }));
  }
  return (
    <Dialog open={modalOpen === 'receiveTransfer'} onOpenChange={(open) => !open && setModalOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Receive Transfer by Lot</DialogTitle>
          </DialogHeader>
          {receivingTransfer && (
            <div className="grid gap-4">
              <div className="grid gap-1 rounded-lg border p-3 text-sm">
                <div><span className="text-muted-foreground">Transfer:</span> <strong>{receivingTransfer.id}</strong></div>
                <div><span className="text-muted-foreground">From:</span> <strong>{receivingTransfer.fromName}</strong></div>
                <div><span className="text-muted-foreground">To:</span> <strong>{receivingTransfer.toName}</strong></div>
              </div>
              <div className="grid gap-3">
                {receiveForm.lines.map((line, index) => {
                  const item = items.find((entry) => entry.id === line.itemId);
                  const lot = item?.lots?.find((entry) => entry.id === line.lotId);
                  const entered = line.receivedQty + line.damagedQty + line.shortageQty;
                  const excess = Number(line.excessQty || 0);
                  return (
                    <div key={line.lineId || `${line.itemId}-${line.lotId}`} className="grid gap-3 rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div><p className="font-medium">{item?.name || line.itemId}</p><p className="text-xs text-muted-foreground">Lot {lot?.lotNo || line.lotId}</p></div>
                        <Badge variant={entered > line.remainingQty ? 'destructive' : 'outline'}>Remaining {line.remainingQty}</Badge>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <div className="grid gap-1"><Label>Good stock</Label><Input type="number" min="0" step="any" value={line.receivedQty} onChange={(event) => updateReceiptLine(index, 'receivedQty', event.target.value)} /></div>
                        <div className="grid gap-1"><Label>Damaged</Label><Input type="number" min="0" step="any" value={line.damagedQty} onChange={(event) => updateReceiptLine(index, 'damagedQty', event.target.value)} /></div>
                        <div className="grid gap-1"><Label>Shortage</Label><Input type="number" min="0" step="any" value={line.shortageQty} onChange={(event) => updateReceiptLine(index, 'shortageQty', event.target.value)} /></div>
                        <div className="grid gap-1"><Label>Excess</Label><Input type="number" min="0" step="any" value={line.excessQty} onChange={(event) => updateReceiptLine(index, 'excessQty', event.target.value)} /></div>
                      </div>
                      <p className={`text-xs ${entered > line.remainingQty ? 'text-destructive' : 'text-muted-foreground'}`}>Entered {entered} of {line.remainingQty} remaining{excess > 0 ? ` · +${excess} excess held for accept/reject` : ''}. Only good stock is added to this branch; damaged/excess wait in quarantine for a disposition decision.</p>
                      {line.receivedQty > 0 && checksForLine(line) && (
                        <div className="grid gap-2 rounded-md bg-muted/40 p-3">
                          <p className="text-xs font-medium">QC required · {checksForLine(line).template.label}</p>
                          <div className="flex flex-wrap gap-2">
                            {checksForLine(line).checks.map((check) => (
                              <button
                                key={check.key}
                                type="button"
                                className={`rounded-full border px-2 py-1 text-xs ${(line.qcResults || {})[check.key] === 'PASS' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : (line.qcResults || {})[check.key] === 'FAIL' ? 'border-destructive text-destructive' : 'text-muted-foreground'}`}
                                onClick={() => setQcResult(index, check.key, (line.qcResults || {})[check.key] === 'PASS' ? 'FAIL' : 'PASS')}
                              >
                                {check.label}: {(line.qcResults || {})[check.key] || 'tap'}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-2"><Label>Notes / discrepancy details</Label><Textarea value={receiveForm.notes} onChange={(event) => setReceiveForm({ ...receiveForm, notes: event.target.value })} /></div>
              <div className="grid gap-2">
                <Label>Evidence photos</Label>
                <Input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => setReceiveForm({ ...receiveForm, photos: Array.from(event.target.files || []) })} />
                <p className="text-xs text-muted-foreground">{receiveForm.photos.length ? `${receiveForm.photos.length} photo(s) selected` : 'JPG, PNG or WEBP · maximum 5 MB each'}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(null)}>Cancel</Button>
            <Button type="button" onClick={submitTransferReceipt} disabled={submitLoading || !receiveForm.lines.length}>
              {submitLoading ? 'Saving receipt...' : 'Post Lot Receipt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
