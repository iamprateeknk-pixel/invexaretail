import { useCallback, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

export function useInventoryAdjustment({ authToken }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const pendingAdjustment = useRef(null);

  const adjust = useCallback(async (itemId, { locationId, lotId, qtyDelta, reason }) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const intent = JSON.stringify([itemId, locationId, lotId, qtyDelta, reason]);
      if (pendingAdjustment.current?.intent !== intent) {
        pendingAdjustment.current = { intent, idempotencyKey: crypto.randomUUID() };
      }
      const { idempotencyKey } = pendingAdjustment.current;
      const response = await apiRequest(`/api/v1/items/${itemId}/adjust`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ locationId, lotId, qtyDelta, reason, idempotencyKey }),
      });
      pendingAdjustment.current = null;
      setResult(response);
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed.');
      return null;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [authToken]);

  const reverse = useCallback(async (itemId, movementId, reason) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiRequest(`/api/v1/items/${itemId}/movements/${movementId}/reverse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ reason }),
      });
      setResult(response);
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reversal failed.');
      return null;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [authToken]);

  return { adjust, reverse, submitting, result, error, clearError: () => setError(null) };
}
