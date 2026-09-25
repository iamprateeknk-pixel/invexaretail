import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';
import { isTerminal } from '../lib/staged-import.js';

// Guide Week 11: per-screen data flow for the staged import wizard (not the
// whole-workspace poll). The server owns every state transition; this hook only
// calls the endpoints in order and polls the batch while it is being committed,
// so progress survives a reload (the batch id is the whole state).
const POLL_MS = 2000;

export function useStagedImport({ authToken }) {
  const [batch, setBatch] = useState(null);
  const [duplicate, setDuplicate] = useState(false);
  const [failures, setFailures] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const headers = useCallback(() => ({ Authorization: `Bearer ${authToken}` }), [authToken]);

  const run = useCallback(async (work) => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request failed.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async (id) => {
    const payload = await apiRequest(`/api/v1/imports/staged/batches/${id}`, { headers: headers() });
    setBatch(payload.batch);
    return payload.batch;
  }, [headers]);

  const loadFailures = useCallback(async (id) => {
    const payload = await apiRequest(`/api/v1/imports/staged/batches/${id}/failures`, { headers: headers() });
    setFailures(payload.rows ?? []);
  }, [headers]);

  /** Preview step: stage the parsed rows, then validate them - nothing is posted. */
  const stage = useCallback(({ type, fileName, rows }) => run(async () => {
    const created = await apiRequest('/api/v1/imports/staged/batches', {
      method: 'POST', headers: headers(), body: JSON.stringify({ type, fileName, sourceFormat: 'csv', rows }),
    });
    setDuplicate(Boolean(created.duplicate));
    let current = created.batch;
    if (current.status === 'DRAFT') {
      await apiRequest(`/api/v1/imports/staged/batches/${current.id}/validate`, { method: 'POST', headers: headers() });
      current = await refresh(current.id);
    } else {
      setBatch(current);
    }
    await loadFailures(current.id);
    return current;
  }), [headers, loadFailures, refresh, run]);

  const commit = useCallback(() => run(async () => {
    await apiRequest(`/api/v1/imports/staged/batches/${batch.id}/commit`, { method: 'POST', headers: headers() });
    return refresh(batch.id);
  }), [batch, headers, refresh, run]);

  const reverse = useCallback((reason) => run(async () => {
    await apiRequest(`/api/v1/imports/staged/batches/${batch.id}/reverse`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ reason }),
    });
    return refresh(batch.id);
  }), [batch, headers, refresh, run]);

  const reset = useCallback(() => {
    setBatch(null);
    setDuplicate(false);
    setFailures([]);
    setError(null);
  }, []);

  // Poll while the server is working; stop as soon as the batch settles.
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!batch || !authToken) return undefined;
    if (!['QUEUED_FOR_COMMIT', 'COMMITTING', 'REVERSING'].includes(batch.status)) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const next = await refresh(batch.id);
        if (isTerminal(next.status)) {
          clearInterval(pollRef.current);
          await loadFailures(batch.id).catch(() => undefined);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lost contact with the server; progress is safe and will resume.');
      }
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [batch, authToken, refresh, loadFailures]);

  return { batch, duplicate, failures, busy, error, stage, commit, reverse, reset };
}
