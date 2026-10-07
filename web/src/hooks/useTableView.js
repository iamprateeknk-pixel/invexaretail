import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterRows, hashWithTableState, readTableStateFromHash, serializeTableQuery, splitHash } from '../lib/table-state';

/**
 * Shared list-page state: search + density + saved views, applied client-side to rows already loaded.
 * The state lives in the URL hash query of the current section (`#/orders?q=rice`), so refresh, back
 * and a shared link keep it. replaceState is used so typing never fills the history.
 */
export function useTableView(rows, getFields) {
  const [state, setStateRaw] = useState(() => readTableStateFromHash(window.location.hash));

  const setState = useCallback((next) => {
    setStateRaw(next);
    const nextHash = hashWithTableState(window.location.hash, next);
    if (nextHash !== window.location.hash) window.history.replaceState(null, '', nextHash);
  }, []);

  // A hash edited by hand (or a pasted link) updates the table; our own replaceState does not fire this.
  useEffect(() => {
    const sync = () => {
      const fromUrl = readTableStateFromHash(window.location.hash);
      setStateRaw((current) => (serializeTableQuery(current) === splitHash(window.location.hash).query ? current : fromUrl));
    };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const visible = useMemo(() => filterRows(rows, state.q, getFields), [rows, state.q, getFields]);
  const compact = state.density === 'compact';
  return { state, setState, visible, compact, rowPadding: compact ? 'p-2' : 'p-3', filtered: visible.length !== (rows?.length ?? 0) };
}
