import { statusBadgeVariant } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Route } from 'lucide-react';

function PickWaveDetail({ waveDetail, updatePickWaveStatus, setWaveDetail }) {
  if (!waveDetail) return null;
  const { wave, lines } = waveDetail;
  return (
    <Card className="border-primary/30">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div><CardTitle className="text-base">Wave {wave.id.slice(-6)} - bin-sequenced pick list</CardTitle><p className="text-xs text-muted-foreground">{wave.transferIds?.length ?? 0} transfers combined, walked in bin order.</p></div>
        <div className="flex gap-2">
          {wave.status === 'OPEN' && <Button size="sm" onClick={() => updatePickWaveStatus(wave.id, 'IN_PROGRESS')}>Start wave</Button>}
          {wave.status === 'IN_PROGRESS' && <Button size="sm" onClick={() => updatePickWaveStatus(wave.id, 'COMPLETED')}>Complete wave</Button>}
          <Button size="sm" variant="outline" onClick={() => setWaveDetail(null)}>Close</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Bin</TableHead><TableHead>Item / Lot</TableHead><TableHead>Total to pick</TableHead><TableHead>Destinations</TableHead></TableRow></TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={`${line.itemId}-${line.lotId}`}>
                <TableCell>{line.binCode ? <Badge variant="secondary">{line.binCode}</Badge> : <span className="text-xs text-muted-foreground">Not yet put away</span>}</TableCell>
                <TableCell><p className="font-medium">{line.itemCode} - {line.itemName}</p><p className="text-xs text-muted-foreground">Lot {line.lotNo}</p></TableCell>
                <TableCell>{line.totalRemainingQty} {line.unit}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{line.destinations.map((d) => `${d.transferId.slice(-6)}: ${d.remainingQty}`).join(' · ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function PickingPage() {
  const {
    workspaceProfile, pickerTasks, role, submitLoading, openPickerTransfer,
    pickWaves, waveDetail, setWaveDetail, selectedTransferIds, toggleTransferSelection,
    createPickWave, openPickWave, updatePickWaveStatus,
  } = useWorkspace();
  const canManageWaves = ['ADMIN', 'ADMIN_USER'].includes(role);
  // A wave can only combine transfers picked from the same source location,
  // so once one task is selected the rest lock to its locationId.
  const selectedLocationId = pickerTasks.find((task) => selectedTransferIds.includes(task.transferId))?.locationId;

  return (
    <div className="space-y-6">
      {waveDetail && <PickWaveDetail waveDetail={waveDetail} updatePickWaveStatus={updatePickWaveStatus} setWaveDetail={setWaveDetail} />}

      {pickWaves.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Open pick waves</CardTitle><p className="text-xs text-muted-foreground">Combined multi-transfer picks waiting to be walked.</p></CardHeader>
          <CardContent className="space-y-2">
            {pickWaves.map((wave) => (
              <div key={wave.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div><p className="text-sm font-medium">Wave {wave.id.slice(-6)} · {wave.location?.name}</p><p className="text-xs text-muted-foreground">{wave.transferIds?.length ?? 0} transfers · {wave.assignedTo?.name ?? 'Unassigned'}</p></div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusBadgeVariant(wave.status)}>{wave.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => openPickWave(wave.id)}>Open</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div><CardTitle className="text-base">Warehouse task queue</CardTitle><p className="text-xs text-muted-foreground">PCS scan controlled · KG manual decimal · {workspaceProfile.pack?.allocationStrategy || 'FEFO'} lot allocations · multiple pick slips</p></div>
          {canManageWaves && <Button size="sm" disabled={selectedTransferIds.length < 2 || submitLoading} onClick={() => createPickWave(selectedLocationId)}><Route className="size-4" />Create pick wave ({selectedTransferIds.length})</Button>}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>{canManageWaves && <TableHead className="w-10" />}<TableHead>Task</TableHead><TableHead>Transfer</TableHead><TableHead>Quantity</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {pickerTasks.length ? pickerTasks.map((task) => (
                <TableRow key={task.id}>
                  {canManageWaves && <TableCell><Checkbox checked={selectedTransferIds.includes(task.transferId)} disabled={Boolean(selectedLocationId) && task.locationId !== selectedLocationId} onCheckedChange={() => toggleTransferSelection(task.transferId)} /></TableCell>}
                  <TableCell className="font-medium">{task.line}</TableCell>
                  <TableCell>{task.transferId}</TableCell>
                  <TableCell>{task.qty} units</TableCell>
                  <TableCell><Badge variant={statusBadgeVariant(task.status)}>{task.status}</Badge></TableCell>
                  <TableCell className="text-right">{['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(role) && <Button size="sm" disabled={submitLoading} onClick={() => openPickerTransfer(task.transferId)}>Open picker</Button>}</TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={canManageWaves ? 6 : 5} className="h-40 text-center text-muted-foreground">No picking tasks are assigned at this location.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
