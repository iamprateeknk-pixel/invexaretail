import { useId, useState } from 'react';
import { DENSITIES, deleteView, hiddenColumnIds, loadSavedViews, saveView, toggleColumn } from '../../lib/table-state.js';
import { downloadCsv, toCsv } from '../../lib/csv.js';

// One toolbar for every operational list: search, density and per-user saved views.
// Controlled: the page owns `state`; saved views live in storage (presentation only).
export function TableToolbar({ tableId, userId, state, onChange, defaults, searchLabel = 'Search', showDensity = true, columns, exportCsv, storage = globalThis.localStorage }) {
  const searchId = useId();
  const [views, setViews] = useState(() => loadSavedViews(storage, userId, tableId, defaults));
  const [name, setName] = useState('');

  const apply = (patch) => onChange({ ...state, ...patch, page: 1 });
  const hidden = hiddenColumnIds(state);
  const exportNow = () => downloadCsv(exportCsv.filename, toCsv(exportCsv.columns, exportCsv.rows));
  const save = () => {
    if (!name.trim()) return;
    setViews(saveView(storage, userId, tableId, name, state, defaults));
    setName('');
  };

  return (
    <div role="toolbar" aria-label="Table controls" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={searchId} className="text-xs text-muted-foreground">{searchLabel}</label>
        <input id={searchId} type="search" value={state.q} onChange={(event) => apply({ q: event.target.value })} className="h-8 w-56 rounded-md border bg-background px-2 text-sm" />
      </div>
      {showDensity && <div role="group" aria-label="Row density" className="flex gap-1">
        {DENSITIES.map((density) => (
          <button key={density} type="button" aria-pressed={state.density === density} onClick={() => apply({ density })} className="h-8 rounded-md border px-2 text-xs capitalize aria-pressed:bg-primary aria-pressed:text-primary-foreground">
            {density}
          </button>
        ))}
      </div>}
      {columns?.length > 0 && (
        <details className="relative">
          <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border px-2 text-xs">Columns</summary>
          <fieldset className="absolute z-20 mt-1 min-w-40 rounded-md border bg-popover p-2 text-xs shadow-md">
            <legend className="sr-only">Visible columns</legend>
            {columns.map((column) => (
              <label key={column.id} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={!hidden.has(column.id)} onChange={() => onChange(toggleColumn(state, column.id, columns.map((entry) => entry.id)))} />
                {column.label}
              </label>
            ))}
          </fieldset>
        </details>
      )}
      {exportCsv && (
        <button type="button" onClick={exportNow} disabled={!exportCsv.rows?.length} className="h-8 rounded-md border px-2 text-xs disabled:opacity-50">
          Export CSV{exportCsv.rows?.length ? ` (${exportCsv.rows.length})` : ''}
        </button>
      )}
      <div className="flex items-end gap-1">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${searchId}-name`} className="text-xs text-muted-foreground">Save view as</label>
          <input id={`${searchId}-name`} value={name} onChange={(event) => setName(event.target.value)} className="h-8 w-36 rounded-md border bg-background px-2 text-sm" />
        </div>
        <button type="button" onClick={save} disabled={!name.trim()} className="h-8 rounded-md border px-2 text-xs disabled:opacity-50">Save</button>
      </div>
      {views.length > 0 && (
        <ul aria-label="Saved views" className="flex flex-wrap gap-1">
          {views.map((view) => (
            <li key={view.id} className="flex items-center rounded-md border text-xs">
              <button type="button" onClick={() => onChange({ ...view.state, page: 1 })} className="px-2 py-1">{view.name}</button>
              <button type="button" aria-label={`Delete view ${view.name}`} onClick={() => setViews(deleteView(storage, userId, tableId, view.id, defaults))} className="px-1.5 py-1 text-muted-foreground">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
