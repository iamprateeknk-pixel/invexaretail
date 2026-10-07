import { useMemo, useState } from 'react';
import { DEFAULT_TABLE_STATE, filterRows } from '../lib/table-state';

/** Shared list-page state: search + density + saved views, applied client-side to rows already loaded. */
export function useTableView(rows, getFields) {
  const [state, setState] = useState(DEFAULT_TABLE_STATE);
  const visible = useMemo(() => filterRows(rows, state.q, getFields), [rows, state.q, getFields]);
  const compact = state.density === 'compact';
  return { state, setState, visible, compact, rowPadding: compact ? 'p-2' : 'p-3', filtered: visible.length !== (rows?.length ?? 0) };
}
