import { useState } from 'react';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ChevronDown, ChevronUp } from 'lucide-react';

// Blueprint P1 "Universal quick add": camera/scan/manual, minimal required
// fields, optional fields behind progressive disclosure. Code/name are the
// only required fields, matching POST /api/v1/items on the backend.
export function QuickAddDialog() {
  const { modalOpen, setModalOpen, quickAddForm, setQuickAddForm, createQuickItem, submitLoading } = useWorkspace();
  const [showMore, setShowMore] = useState(false);
  const open = modalOpen === 'quickAdd';

  function field(key, label, placeholder) {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`quick-add-${key}`}>{label}</Label>
        <Input
          id={`quick-add-${key}`}
          value={quickAddForm[key]}
          placeholder={placeholder}
          onChange={(event) => setQuickAddForm((current) => ({ ...current, [key]: event.target.value }))}
        />
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setModalOpen(null); setShowMore(false); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add item</DialogTitle>
          <DialogDescription>Save in seconds. Add category, brand and pack details later if you need them.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {field('code', 'Item code', 'e.g., SKU-1042')}
          {field('name', 'Item name', 'e.g., Amul Butter 500g')}
          <Button type="button" variant="ghost" size="sm" className="justify-start px-0 text-muted-foreground" onClick={() => setShowMore((value) => !value)}>
            {showMore ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            {showMore ? 'Hide extra fields' : 'Add category, brand, pack size'}
          </Button>
          {showMore && (
            <div className="grid gap-3 sm:grid-cols-2">
              {field('category', 'Category', 'e.g., Dairy')}
              {field('subcategory', 'Sub category', 'e.g., Butter & Ghee')}
              {field('company', 'Company / brand', 'e.g., Amul')}
              {field('unit', 'Pack / size', 'e.g., 500g')}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { setModalOpen(null); setShowMore(false); }}>Cancel</Button>
          <Button type="button" onClick={createQuickItem} disabled={submitLoading || !quickAddForm.code.trim() || !quickAddForm.name.trim()}>
            {submitLoading ? 'Saving…' : 'Save item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
