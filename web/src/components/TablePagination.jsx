import { Button } from './ui/button.jsx';

export function TablePagination({ model, onPageChange, onPageSizeChange }) {
  if (!model || model.total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
      <p>Showing {model.from}–{model.to} of {model.total}</p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          Rows
          <select
            className="h-8 rounded-md border bg-background px-2 text-foreground"
            value={model.pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <Button type="button" size="sm" variant="outline" disabled={model.page <= 1} onClick={() => onPageChange(model.page - 1)}>Previous</Button>
        <span className="min-w-16 text-center">Page {model.page} / {model.pageCount}</span>
        <Button type="button" size="sm" variant="outline" disabled={model.page >= model.pageCount} onClick={() => onPageChange(model.page + 1)}>Next</Button>
      </div>
    </div>
  );
}
