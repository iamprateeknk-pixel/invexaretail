import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScanLine } from 'lucide-react';

export function ScannerDialog() {
  const {
    cameraActive, modalOpen, openQuickAdd, scanStatus, scanValue,
    scannerVideoRef, setCameraActive, setModalOpen, setScanValue,
    resolveScannedCode,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'scanner'} onOpenChange={(open) => { if (!open) { setCameraActive(false); setModalOpen(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Scan inventory barcode</DialogTitle>
            <DialogDescription>Resolve a SKU, item ID, lot barcode, Code 39/128, EAN, or QR code.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Button type="button" variant="outline" onClick={() => setCameraActive(!cameraActive)}>
              <ScanLine className="size-4" />{cameraActive ? 'Close camera' : 'Open camera'}
            </Button>
            {cameraActive && (
              <div className="relative overflow-hidden rounded-lg border bg-slate-950">
                <video ref={scannerVideoRef} className="aspect-video block w-full object-cover" playsInline muted />
                <div className="pointer-events-none absolute inset-x-10 top-1/2 h-20 -translate-y-1/2 rounded-lg border-2 border-primary/90 shadow-[0_0_0_999px_rgba(2,6,23,.35)]" />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="scan-code">Scanner or manual code</Label>
              <Input
                id="scan-code"
                autoFocus
                autoComplete="off"
                placeholder="e.g., SKU-001 or LOT-001"
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value.toUpperCase())}
                onKeyDown={(event) => { if (event.key === 'Enter') resolveScannedCode(scanValue); }}
              />
              <p className="text-xs text-muted-foreground" aria-live="polite">{scanStatus}</p>
            </div>
            {scanValue.trim() && (
              <Button type="button" variant="ghost" size="sm" className="justify-start px-0" onClick={() => openQuickAdd(scanValue)}>
                Not in the catalogue? Add "{scanValue}" as a new item
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setCameraActive(false); setModalOpen(null); }}>Cancel</Button>
            <Button type="button" onClick={() => resolveScannedCode(scanValue)} disabled={!scanValue.trim()}>Resolve item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
