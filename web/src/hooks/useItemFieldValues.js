import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

/** True when any published stock column shows an item custom field. */
export function usesItemFields(columns) {
  return (columns ?? []).some((column) => column.source === 'itemField' && column.itemField);
}

/** Value of one item's custom field for a table cell ('—' when the item has none). */
export function itemFieldCell(values, itemId, fieldName) {
  return values?.[itemId]?.[fieldName] ?? '—';
}

// A per-screen query (not part of the workspace poll): fetched once, and only when a column needs it.
export function useItemFieldValues({ authToken, enabled }) {
  const [values, setValues] = useState({});
  useEffect(() => {
    if (!enabled || !authToken) return undefined;
    let cancelled = false;
    apiRequest('/api/v1/catalog/custom-field-values', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((result) => { if (!cancelled) setValues(result?.values ?? {}); })
      .catch(() => { if (!cancelled) setValues({}); });
    return () => { cancelled = true; };
  }, [authToken, enabled]);
  return values;
}
