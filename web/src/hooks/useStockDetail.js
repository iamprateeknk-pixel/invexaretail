import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

// Week 10: a per-screen query, not a slice of the whole-workspace poll -
// fetches once when itemId changes and exposes a manual refetch (called
// after a successful adjustment/reversal), rather than waiting for the
// next global hydration/poll cycle to catch up.
export function useStockDetail({ authToken, itemId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!authToken || !itemId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest(`/api/v1/items/${itemId}/stock-detail`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock detail.');
    } finally {
      setLoading(false);
    }
  }, [authToken, itemId]);

  useEffect(() => {
    setDetail(null);
    refetch();
  }, [refetch]);

  return { detail, loading, error, refetch };
}
