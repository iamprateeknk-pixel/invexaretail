import { useState } from 'react';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, PackageSearch } from 'lucide-react';

function TaskRow({ task, bins, confirmPutaway, submitLoading }) {
  const [binId, setBinId] = useState(task.suggestedBin?.id ?? '');
  const [scannedBinCode, setScannedBinCode] = useState('');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{task.item?.code} - {task.item?.name}</p>
        <p className="text-xs text-muted-foreground">
          Qty {task.quantity}{task.lot ? ` · Lot ${task.lot.lotNo}` : ''} · {task.location?.name}
          {task.suggestedBin ? ` · Suggested bin ${task.suggestedBin.code}` : ' · No bin suggestion available'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-36" placeholder="Scan bin code" value={scannedBinCode} onChange={(event) => setScannedBinCode(event.target.value)} />
        <Select value={binId} onValueChange={setBinId}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Choose bin" /></SelectTrigger>
          <SelectContent>{bins.map((bin) => <SelectItem key={bin.id} value={bin.id}>{bin.code}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" disabled={!binId || submitLoading} onClick={() => confirmPutaway(task.id, binId, scannedBinCode)}>Confirm</Button>
      </div>
    </div>
  );
}

export function PutawayPage() {
  const { role, bins, binStock, putawayTasks, binForm, setBinForm, createBin, confirmPutaway, submitLoading } = useWorkspace();
  const isAdmin = ['ADMIN', 'ADMIN_USER'].includes(role);

  return (
    <div className="space-y-6">
      {isAdmin && (
        <Card>
          <CardHeader><CardTitle className="text-base">Bin directory</CardTitle><p className="text-xs text-muted-foreground">Zone / aisle / rack / shelf / bin hierarchy for this location.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
              <Input placeholder="Bin code" value={binForm.code} onChange={(event) => setBinForm({ ...binForm, code: event.target.value })} />
              <Input placeholder="Zone" value={binForm.zone} onChange={(event) => setBinForm({ ...binForm, zone: event.target.value })} />
              <Input placeholder="Aisle" value={binForm.aisle} onChange={(event) => setBinForm({ ...binForm, aisle: event.target.value })} />
              <Input placeholder="Rack" value={binForm.rack} onChange={(event) => setBinForm({ ...binForm, rack: event.target.value })} />
              <Input placeholder="Shelf" value={binForm.shelf} onChange={(event) => setBinForm({ ...binForm, shelf: event.target.value })} />
              <Input placeholder="Storage class / category" value={binForm.storageClass} onChange={(event) => setBinForm({ ...binForm, storageClass: event.target.value })} />
              <Button onClick={createBin} disabled={submitLoading || !binForm.code.trim()}>Add bin</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {bins.length ? bins.map((bin) => (
                <Badge key={bin.id} variant="outline">{bin.code}{bin.storageClass ? ` · ${bin.storageClass}` : ''}</Badge>
              )) : <p className="text-sm text-muted-foreground">No bins defined yet for this location.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Putaway queue</CardTitle><p className="text-xs text-muted-foreground">Received stock waiting to be placed in a bin. Confirming records where it actually went.</p></CardHeader>
        <CardContent className="space-y-2">
          {putawayTasks.length ? putawayTasks.map((task) => (
            <TaskRow key={task.id} task={task} bins={bins} confirmPutaway={confirmPutaway} submitLoading={submitLoading} />
          )) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-3 size-8 text-emerald-500" />
              Nothing waiting to be put away.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Live bin stock</CardTitle><p className="text-xs text-muted-foreground">Bin-granularity on-hand, separate from location ATP.</p></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {binStock?.length ? binStock.map((row) => (
            <Badge key={`${row.binId}-${row.itemId}-${row.lotId}`} variant="outline">
              {row.binId === '__STAGING__' ? 'STAGING' : row.binId} · {row.item?.code || row.itemId} · {row.onHand}
            </Badge>
          )) : <p className="text-sm text-muted-foreground">No bin-level stock at this location yet. Confirm putaway to move staging receipts into a bin.</p>}
        </CardContent>
      </Card>

      {!bins.length && isAdmin && (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
            <PackageSearch className="size-5" /> Add bins above so putaway tasks get a suggested location automatically.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
