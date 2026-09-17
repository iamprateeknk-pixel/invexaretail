import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search } from 'lucide-react';

// A dropdown of every catalog item is unusable once there are more than a
// handful of SKUs - there's no way to type to filter. This opens a search
// dialog (type to filter by name or code) instead, using only components
// already in the app (no new dependency needed for a searchable combobox).
export function ItemSearchSelect({ items, value, onChange, placeholder = 'Select item…', disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = items.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle));
  }, [items, query]);

  return <>
    <Button
      type="button"
      variant="outline"
      disabled={disabled || !items.length}
      className="w-full justify-start font-normal"
      onClick={() => setOpen(true)}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <span className={selected ? '' : 'text-muted-foreground'}>
        {selected ? `${selected.code} - ${selected.name}` : placeholder}
      </span>
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80svh] overflow-hidden sm:max-w-md">
        <DialogHeader><DialogTitle>Search items</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Search by name or code…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {filtered.length ? filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full flex-col items-start border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
              onClick={() => { onChange(item.id); setOpen(false); setQuery(''); }}
            >
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-muted-foreground">{item.code}</span>
            </button>
          )) : <p className="p-4 text-center text-sm text-muted-foreground">No matching items.</p>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
