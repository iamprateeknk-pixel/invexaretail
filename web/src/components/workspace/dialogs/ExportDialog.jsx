import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function ExportDialog() {
  const {
    exportData, modalOpen, setModalOpen,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'export'} onOpenChange={(open) => !open && setModalOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Data</DialogTitle>
            <DialogDescription>Download data as CSV for backup or analysis</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button type="button" variant="outline" onClick={() => exportData('stock')}>Export Stock Items</Button>
            <Button type="button" variant="outline" onClick={() => exportData('counts')}>Export Stock Counts</Button>
            <Button type="button" variant="outline" onClick={() => exportData('transfers')}>Export Transfers</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
