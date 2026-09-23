import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

// Week 10: server-paginated item search, replacing the whole-item-list
// client-side filter pattern (ItemSearchSelect.jsx) for the new global
// search entry point. Debounces the query, cancels a stale in-flight
// request when a newer one starts (so a fast typist never sees an older
// response overwrite a newer one), and appends pages rather than
// re-fetching from the start.
const DEBOUNCE_MS = 250;

export function useItemSearch({ authToken, pageSize = 25 }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const debounceRef = useRef(null);

  const runSearch = useCallback(async (searchTerm, cursor) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('q', searchTerm);
      params.set('limit', String(pageSize));
      if (cursor) params.set('cursor', cursor);
      const page = await apiRequest(`/api/v1/items/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (requestId !== requestIdRef.current) return; // a newer search has since started - discard this stale response
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [authToken, pageSize]);

  useEffect(() => {
    if (!authToken) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, undefined), DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [query, authToken, runSearch]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading) return;
    runSearch(query, nextCursor);
  }, [nextCursor, loading, query, runSearch]);

  const retry = useCallback(() => runSearch(query, undefined), [query, runSearch]);

  return { query, setQuery, items, loading, error, hasMore: Boolean(nextCursor), loadMore, retry };
}
