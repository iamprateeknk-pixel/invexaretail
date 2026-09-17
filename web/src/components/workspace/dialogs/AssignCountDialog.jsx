import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function AssignCountDialog() {
  const {
    assignForm, items, locations, modalOpen,
    setAssignForm, setModalOpen, storeUsers, submitAssignCount,
    submitLoading,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'assignCount'} onOpenChange={(open) => !open && setModalOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Stock Count</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Store</Label>
              <Select value={assignForm.locationId} onValueChange={(value) => setAssignForm({ ...assignForm, locationId: value })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {locations.filter((loc) => loc.type === 'store').map((loc) => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Store User</Label>
              <Select value={assignForm.storeUserId} onValueChange={(value) => setAssignForm({ ...assignForm, storeUserId: value })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select a store user" /></SelectTrigger>
                <SelectContent>
                  {storeUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name} ({user.email})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Item</Label>
              <Select value={assignForm.itemId} onValueChange={(value) => setAssignForm({ ...assignForm, itemId: value })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select an item" /></SelectTrigger>
                <SelectContent>
                  {items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} ({item.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Due date (optional)</Label>
              <Input type="date" value={assignForm.dueDate} onChange={(e) => setAssignForm({ ...assignForm, dueDate: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Priority</Label>
              <Select value={assignForm.priority} onValueChange={(value) => setAssignForm({ ...assignForm, priority: value })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Instructions (optional)</Label>
              <Input value={assignForm.instructions} onChange={(e) => setAssignForm({ ...assignForm, instructions: e.target.value })} placeholder="e.g., Please count carefully" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(null)}>Cancel</Button>
            <Button type="button" onClick={submitAssignCount} disabled={submitLoading}>{submitLoading ? 'Assigning...' : 'Assign'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
