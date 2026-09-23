import { useCallback, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

// Week 10: posts through the canonical InventoryPostingService
// (routes/items.ts's /adjust and /reverse endpoints) with a client-
// generated idempotency key. `submitting` is the duplicate-submit guard -
// the wizard disables its submit button while true, so a double-click or a
// slow-network retry from the same mount cannot fire two requests; a
// genuinely new request (a fresh key) after the first completes is a new,
// intentional post, not a duplicate.
export function useInventoryAdjustment({ authToken }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const adjust = useCallback(async (itemId, { locationId, lotId, qtyDelta, reason }) => {
    if (submitting) return null;
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await apiRequest(`/api/v1/items/${itemId}/adjust`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ locationId, lotId, qtyDelta, reason, idempotencyKey }),
      });
      setResult(response);
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed.');
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [authToken, submitting]);

  const reverse = useCallback(async (itemId, movementId, reason) => {
    if (submitting) return null;
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
      setSubmitting(false);
    }
  }, [authToken, submitting]);

  return { adjust, reverse, submitting, result, error, clearError: () => setError(null) };
}
