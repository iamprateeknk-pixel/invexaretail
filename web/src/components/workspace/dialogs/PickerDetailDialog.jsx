import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
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

export function PickerDetailDialog() {
  const {
    modalOpen, pickDrafts, pickerDetail, role,
    savePickSlip, setModalOpen, setPickDrafts, setPickerDetail,
    submitLoading,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'pickerDetail'} onOpenChange={(open) => { if (!open) { setModalOpen(null); setPickerDetail(null); } }}>
        <DialogContent className="w-[calc(100%-1rem)] max-h-[92vh] sm:max-w-5xl">
          <DialogHeader><DialogTitle>Picker session · {pickerDetail?.transfer?.id}</DialogTitle><DialogDescription>PCS lines require a matching item/lot scan. KG lines allow manual quantities to three decimal places. Save as many partial slips as needed.</DialogDescription></DialogHeader>
          <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
            {pickerDetail?.transfer?.lines?.map((line) => { const draft = pickDrafts[line.lineId] ?? {}; const setDraft = (patch) => setPickDrafts((current) => ({ ...current, [line.lineId]: { ...current[line.lineId], ...patch } })); return <div key={line.lineId} className="grid gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{line.itemCode} · {line.itemName}</p><p className="text-xs text-muted-foreground">Lot {line.lotNo} · Expiry {line.expiryDate ? new Date(line.expiryDate).toLocaleDateString('en-IN') : 'N/A'} · Available {line.lotAvailable}</p></div><div className="flex gap-2"><Badge variant="outline">{line.unit}</Badge><Badge variant={line.remainingQty ? 'warning' : 'success'}>{line.pickedQty}/{line.requestedQty} picked</Badge></div></div>
              {line.remainingQty > 0 ? <div className="grid gap-3 md:grid-cols-[1.2fr_140px_1fr_120px]">
                <div className="grid gap-1.5"><Label>{line.unit?.toUpperCase() === 'PCS' ? 'Scan item or lot code' : 'Manual KG entry'}</Label>{line.unit?.toUpperCase() === 'PCS' ? <Input value={draft.scanCode ?? ''} onChange={(event) => setDraft({ scanCode: event.target.value.trim().toUpperCase() })} placeholder={`${line.itemCode} or ${line.lotNo}`} disabled={role !== 'WAREHOUSE_PICKER'} /> : <p className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm">Manual weighing</p>}</div>
                <div className="grid gap-1.5"><Label>Pick quantity</Label><Input type="number" min="0" max={line.remainingQty} step={line.unit?.toUpperCase() === 'PCS' ? '1' : '0.001'} value={draft.quantity ?? ''} onChange={(event) => setDraft({ quantity: event.target.value })} disabled={role !== 'WAREHOUSE_PICKER'} /></div>
                <div className="grid gap-1.5"><Label>Exception</Label><Select value={draft.exceptionReason || 'none'} onValueChange={(value) => setDraft({ exceptionReason: value === 'none' ? '' : value })} disabled={role !== 'WAREHOUSE_PICKER'}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No exception</SelectItem><SelectItem value="NO_STOCK">No stock</SelectItem><SelectItem value="WRONG_ITEM">Wrong item</SelectItem><SelectItem value="DAMAGED_ITEM">Damaged item</SelectItem></SelectContent></Select></div>
                <div className="grid gap-1.5"><Label>Exception qty</Label><Input type="number" min="0" step={line.unit?.toUpperCase() === 'PCS' ? '1' : '0.001'} value={draft.exceptionQty ?? ''} onChange={(event) => setDraft({ exceptionQty: event.target.value })} disabled={role !== 'WAREHOUSE_PICKER'} /></div>
              </div> : <Alert><AlertDescription>This lot allocation is fully picked.</AlertDescription></Alert>}
              {draft.exceptionReason && <Textarea value={draft.note ?? ''} onChange={(event) => setDraft({ note: event.target.value })} placeholder="Exception note / damage detail" disabled={role !== 'WAREHOUSE_PICKER'} />}
            </div>; })}
            {pickerDetail?.pickSlips?.length > 0 && <p className="text-xs text-muted-foreground">Saved pick slips: {pickerDetail.pickSlips.length}</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setModalOpen(null)}>Close</Button>{role === 'WAREHOUSE_PICKER' && <><Button variant="outline" onClick={() => savePickSlip(false)} disabled={submitLoading}>{submitLoading ? 'Saving…' : 'Save partial slip'}</Button><Button onClick={() => savePickSlip(true)} disabled={submitLoading}>{submitLoading ? 'Saving…' : 'Finish for admin'}</Button></>}</DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
