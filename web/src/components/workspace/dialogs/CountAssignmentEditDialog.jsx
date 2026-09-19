import { useEffect, useState } from 'react';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function dateValue(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

export function CountAssignmentEditDialog() {
  const {
    modalOpen, setModalOpen, selectedCountTask, storeUsers, submitLoading,
    updateCountAssignment, deleteCountAssignment, role,
  } = useWorkspace();
  const [form, setForm] = useState({ assignedToId: '', dueDate: '', priority: 'NORMAL', instructions: '' });
  const isAdmin = role === 'ADMIN' || role === 'ADMIN_USER';

  useEffect(() => {
    if (!selectedCountTask) return;
    setForm({
      assignedToId: selectedCountTask.assignedToId ?? '',
      dueDate: dateValue(selectedCountTask.dueAt ?? selectedCountTask.dueDate),
      priority: selectedCountTask.priority === 'Urgent' ? 'HIGH' : String(selectedCountTask.priority ?? 'NORMAL').toUpperCase(),
      instructions: selectedCountTask.instructions ?? '',
    });
  }, [selectedCountTask]);

  if (!selectedCountTask?.assignmentId || !isAdmin) return null;
  const save = () => updateCountAssignment(selectedCountTask.assignmentId, {
    assignedToId: form.assignedToId,
    dueDate: form.dueDate || null,
    priority: form.priority,
    instructions: form.instructions,
  });
  const remove = () => {
    if (window.confirm('Delete this count task? Any submitted count history will be preserved.')) {
      deleteCountAssignment(selectedCountTask.assignmentId);
    }
  };

  return (
    <Dialog open={modalOpen === 'editCountAssignment'} onOpenChange={(open) => !open && setModalOpen(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modify count task</DialogTitle>
          <DialogDescription>{selectedCountTask.item ?? selectedCountTask.itemId} · {selectedCountTask.locationName}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2"><Label>Assigned user</Label><Select value={form.assignedToId} onValueChange={(value) => setForm({ ...form, assignedToId: value })}><SelectTrigger className="w-full"><SelectValue placeholder="Select store user" /></SelectTrigger><SelectContent>{storeUsers.filter((user) => user.assignedLocationIds?.includes(selectedCountTask.locationId)).map((user) => <SelectItem key={user.id} value={user.id}>{user.name ?? user.email}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Due date</Label><Input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></div>
          <div className="grid gap-2"><Label>Priority</Label><Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="LOW">Low</SelectItem><SelectItem value="NORMAL">Normal</SelectItem><SelectItem value="HIGH">Urgent</SelectItem></SelectContent></Select></div>
          <div className="grid gap-2"><Label>Instructions</Label><Input value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} placeholder="Optional instructions for the counter" /></div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="destructive" onClick={remove} disabled={submitLoading}>Delete task</Button>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setModalOpen(null)}>Cancel</Button><Button type="button" onClick={save} disabled={submitLoading || !form.assignedToId}>{submitLoading ? 'Saving…' : 'Save changes'}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}