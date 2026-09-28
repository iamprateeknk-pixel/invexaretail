import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

// Audit O-5/C-3: one per-screen query for the inventory-health report and the count-quality reports.
// Not part of the whole-workspace poll; refetches when the location or window changes.
export function useInventoryHealth({ authToken, locationId, windowDays = 30 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!authToken || !locationId) return;
    setLoading(true);
    setError(null);
    const headers = { Authorization: `Bearer ${authToken}` };
    try {
      const [health, accuracy, reasons] = await Promise.all([
        apiRequest(`/api/v1/reports/inventory-health?locationId=${encodeURIComponent(locationId)}&windowDays=${windowDays}`, { headers }),
        apiRequest('/api/v1/reports/count-accuracy-breakdown', { headers }),
        apiRequest('/api/v1/reports/count-variance-reasons', { headers }),
      ]);
      setData({ health, accuracy, reasons: reasons.reasons ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory health.');
    } finally {
      setLoading(false);
    }
  }, [authToken, locationId, windowDays]);

  useEffect(() => {
    setData(null);
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
