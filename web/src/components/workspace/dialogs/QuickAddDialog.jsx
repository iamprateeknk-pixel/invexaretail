import { useEffect, useState } from 'react';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import { ErrorState, LoadingState } from '@/components/ui/feedback-states';
import { StudioItemFieldInput } from '@/components/inventory/StudioItemFieldInput';

export function QuickAddDialog() {
  const { modalOpen, setModalOpen } = useWorkspace();
  const open = modalOpen === 'quickAdd';
  const close = () => setModalOpen(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add item</DialogTitle>
          <DialogDescription>Enter the item code, name and any fields set by your company.</DialogDescription>
        </DialogHeader>
        {open && <QuickAddForm close={close} />}
      </DialogContent>
    </Dialog>
  );
}

function QuickAddForm({ close }) {
  const { authToken, quickAddForm, setQuickAddForm, createQuickItem, submitLoading } = useWorkspace();
  const [showMore, setShowMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [needsReload, setNeedsReload] = useState(false);
  const loaded = result?.attempt === attempt && result?.authToken === authToken ? result : null;
  const reload = () => { setNeedsReload(false); setAttempt((current) => current + 1); };
  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/api/v1/items/studio-create-fields', {
      headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal,
    }).then(
      (data) => { if (!controller.signal.aborted) setResult({ attempt, authToken, data }); },
      (error) => { if (!controller.signal.aborted) setResult({ attempt, authToken, error }); },
    );
    return () => controller.abort();
  }, [attempt, authToken]);

  async function submit(event) {
    event.preventDefault();
    if (!loaded?.data || needsReload || submitLoading) return;
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(loaded.data.fields.map(({ key, type }) => {
      const text = String(form.get(`studio:${key}`) ?? '').trim();
      if (!text) return [key, null];
      if (type === 'number') return [key, Number(text)];
      if (type === 'boolean') return [key, text === 'true'];
      return [key, text];
    }));
    const code = await createQuickItem({ versionId: loaded.data.versionId, values });
    if (code === 'CONCURRENT_UPDATE_CONFLICT') setNeedsReload(true);
  }

  function field(key, label, placeholder) {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`quick-add-${key}`}>{label}</Label>
        <Input
          id={`quick-add-${key}`}
          value={quickAddForm[key] ?? ''}
          placeholder={placeholder}
          onChange={(event) => setQuickAddForm((current) => ({ ...current, [key]: event.target.value }))}
        />
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
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
          {!loaded && <LoadingState label="Loading item fields…" className="min-h-20" />}
          {loaded?.error && <ErrorState title="Could not load item fields" description={loaded.error.message} onRetry={reload} className="min-h-20" />}
          {loaded?.data?.fields.map((entry) => (
            <StudioItemFieldInput key={`${attempt}:${entry.key}`} field={entry} name={`studio:${entry.key}`} defaultValue={String(entry.value ?? '')} />
          ))}
          {needsReload && <Button type="button" variant="outline" onClick={reload}>Reload item fields</Button>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="submit" disabled={submitLoading || !loaded?.data || needsReload || !quickAddForm.code.trim() || !quickAddForm.name.trim()}>
            {submitLoading ? 'Saving…' : 'Save item'}
          </Button>
        </DialogFooter>
    </form>
  );
}
