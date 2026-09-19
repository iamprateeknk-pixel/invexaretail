import { formatDateTime, statusBadgeVariant } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2 } from 'lucide-react';

export function CountTaskSheet() {
  const {
    canManageCounts, navigateTo, pickAssignment, role,
    selectedCountTask, setModalOpen, setReviewReason, setReviewingCount,
    setSelectedCountTask,
  } = useWorkspace();
  return (
    <Sheet open={Boolean(selectedCountTask)} onOpenChange={(open) => !open && setSelectedCountTask(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedCountTask && (
            <>
              <SheetHeader className="border-b pb-5 text-left">
                <div className="mb-2 flex items-center gap-2"><Badge variant={selectedCountTask.overdue ? 'destructive' : statusBadgeVariant(selectedCountTask.status)}>{selectedCountTask.overdue ? `${selectedCountTask.status} · Overdue` : selectedCountTask.status}</Badge><Badge variant="outline">{selectedCountTask.priority}</Badge></div>
                <SheetTitle>{selectedCountTask.item ?? selectedCountTask.itemId}</SheetTitle>
                <SheetDescription>{selectedCountTask.id} · {selectedCountTask.locationName}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 py-6">
                <div className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                  {[
                    ['Task type', 'Blind stock count'], ['Assigned to', selectedCountTask.assignedToName], ['Created on', formatDateTime(selectedCountTask.createdAt)], ['Pending since', formatDateTime(selectedCountTask.pendingSince)], ['Started on', formatDateTime(selectedCountTask.startedAt)], ['Due date and time', formatDateTime(selectedCountTask.dueAt)], ['Item count', selectedCountTask.itemCount ?? 1], ['Count mode', selectedCountTask.mode === 'scan' ? 'Barcode scan' : 'Manual entry'],
                  ].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>)}
                </div>
                <Separator />
                <div><div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">Progress</span><strong>{selectedCountTask.progress}%</strong></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${selectedCountTask.progress}%` }} /></div></div>
                <Separator />
                <div><h3 className="mb-4 text-sm font-semibold">Activity timeline</h3><div className="space-y-0">{[
                  ['Created', selectedCountTask.createdAt, true], ['Assigned', selectedCountTask.assignedAt, true], ['Started', selectedCountTask.startedAt, Boolean(selectedCountTask.startedAt)], ['Submitted', selectedCountTask.submittedAt, ['Pending review','Approved','Rejected','Recount'].includes(selectedCountTask.status)], ['Reviewed', selectedCountTask.reviewedAt, ['Approved','Rejected','Recount'].includes(selectedCountTask.status)],
                ].map(([label, time, complete], index) => <div key={label} className="relative flex gap-3 pb-5"><div className="relative z-10 mt-0.5 flex size-5 items-center justify-center rounded-full border bg-background">{complete ? <CheckCircle2 className="size-4 text-primary" /> : <div className="size-2 rounded-full bg-muted-foreground/30" />}</div>{index < 4 && <div className="absolute top-5 left-[9px] h-full w-px bg-border" />}<div><p className={`text-sm font-medium ${complete ? '' : 'text-muted-foreground'}`}>{label}</p><p className="text-xs text-muted-foreground">{complete ? formatDateTime(time ?? selectedCountTask.createdAt) : 'Not reached'}</p></div></div>)}</div></div>
                <div className="flex flex-wrap gap-2 border-t pt-5"><Button variant="outline" onClick={() => setSelectedCountTask(null)}>Close</Button>{["ADMIN", "ADMIN_USER"].includes(role) && selectedCountTask.assignmentId && <Button variant="outline" onClick={() => setModalOpen("editCountAssignment")}>Modify task</Button>}{canManageCounts && String(selectedCountTask.status).toLowerCase().includes('pending') && <Button onClick={() => { setReviewingCount(selectedCountTask); setReviewReason(''); setSelectedCountTask(null); setModalOpen('reviewVariance'); }}>Review count</Button>}{['STORE_USER', 'WAREHOUSE_PICKER'].includes(role) && selectedCountTask.assignmentId && <Button onClick={() => { pickAssignment(selectedCountTask); setSelectedCountTask(null); navigateTo('counts'); }}>Start blind count</Button>}</div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
  );
}
