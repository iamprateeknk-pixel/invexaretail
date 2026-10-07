import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

/**
 * A bundle answer with every field the panel reads, whatever the server sent. An older API, a proxy error
 * page or an empty body must show "not a bundle", never crash the whole stock-detail screen.
 */
export function normalizeBundle(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const components = Array.isArray(value.components) ? value.components.filter((c) => c && typeof c === 'object') : [];
  return {
    isBundle: value.isBundle === true && components.length > 0,
    components,
    buildable: Number.isFinite(Number(value.buildable)) ? Number(value.buildable) : 0,
    limitingItemId: typeof value.limitingItemId === 'string' ? value.limitingItemId : null,
    locationId: typeof value.locationId === 'string' ? value.locationId : null,
  };
}

// Per-screen query for an item's virtual bundle definition and how many
// bundles current component stock can build.
export function useBundle({ authToken, itemId }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!authToken || !itemId) return;
    setLoading(true);
    setError(null);
    try {
      setBundle(normalizeBundle(await apiRequest(`/api/v1/items/${itemId}/bundle`, { headers: { Authorization: `Bearer ${authToken}` } })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bundle.');
    } finally {
      setLoading(false);
    }
  }, [authToken, itemId]);

  useEffect(() => {
    setBundle(null);
    refetch();
  }, [refetch]);

  const save = useCallback(async (components) => {
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/items/${itemId}/bundle`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ components }),
      });
      await refetch();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bundle.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [authToken, itemId, refetch]);

  const remove = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/items/${itemId}/bundle`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove bundle.');
    } finally {
      setSaving(false);
    }
  }, [authToken, itemId, refetch]);

  return { bundle, loading, saving, error, save, remove };
}
