import { useWorkspace } from '../WorkspaceContext';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ChevronRight, Search } from 'lucide-react';

export function CommandPaletteDialog() {
  const {
    commandPaletteOpen, commandQuery, commandResults, runCommand,
    setCommandPaletteOpen, setCommandQuery,
  } = useWorkspace();
  return (
    <>
      <Dialog open={commandPaletteOpen} onOpenChange={(open) => { setCommandPaletteOpen(open); if (!open) setCommandQuery(''); }}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="sr-only"><DialogTitle>Quick command search</DialogTitle><DialogDescription>Search workspaces and common inventory actions.</DialogDescription></DialogHeader>
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search className="size-5 text-muted-foreground" />
            <Input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && commandResults[0]) runCommand(commandResults[0]); }} className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" placeholder="Search pages and actions…" aria-label="Quick command search" />
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">Esc</kbd>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-2">
            {commandResults.length ? commandResults.map((command) => {
              const Icon = command.icon;
              return <button key={command.id} type="button" onClick={() => runCommand(command)} className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{command.label}</span><span className="block truncate text-xs text-muted-foreground">{command.description}</span></span><ChevronRight className="size-4 text-muted-foreground" /></button>;
            }) : <div className="px-4 py-12 text-center"><Search className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="text-sm font-medium">No matching command</p><p className="mt-1 text-xs text-muted-foreground">Try item, transfer, count or report.</p></div>}
          </div>
          <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"><span>Enter to open first result</span><span>⌘ K to search anytime</span></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
