import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

// A per-screen query (like useStockDetail): fetches the 360 view when the entity changes.
export function useEntity360({ authToken, type, id }) {
  const [entity, setEntity] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | notfound | error
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    if (!authToken || !type || !id) return;
    setStatus('loading');
    setError('');
    try {
      const data = await apiRequest(`/api/v1/entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}/360`, { headers: { Authorization: `Bearer ${authToken}` } });
      setEntity(data.entity);
      setStatus('ready');
    } catch (err) {
      setEntity(null);
      if (Number(err?.status) === 404) setStatus('notfound');
      else { setStatus('error'); setError(err instanceof Error ? err.message : 'Failed to load this view.'); }
    }
  }, [authToken, type, id]);

  useEffect(() => { refetch(); }, [refetch]);
  return { entity, status, error, refetch };
}
