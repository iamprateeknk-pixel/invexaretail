import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';

// Per-screen query for the signed-in user's two-factor state and the
// enrol / confirm / disable actions. Never stores the secret beyond the
// setup step's own state.
export function useTwoFactor({ authToken }) {
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null); // { secret, otpauthUri } while enrolling
  const [backupCodes, setBackupCodes] = useState(null); // shown once after enabling
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const headers = useCallback(() => ({ Authorization: `Bearer ${authToken}` }), [authToken]);

  const refresh = useCallback(async () => {
    if (!authToken) return;
    try {
      setStatus(await apiRequest('/api/v1/auth/2fa/status', { headers: headers() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load two-factor status.');
    }
  }, [authToken, headers]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = useCallback(async (action) => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const begin = useCallback(() => run(async () => {
    setSetup(await apiRequest('/api/v1/auth/2fa/setup', { method: 'POST', headers: headers(), body: JSON.stringify({}) }));
  }), [run, headers]);

  const enable = useCallback((code) => run(async () => {
    const result = await apiRequest('/api/v1/auth/2fa/enable', { method: 'POST', headers: headers(), body: JSON.stringify({ code }) });
    setSetup(null);
    setBackupCodes(result.backupCodes);
    await refresh();
  }), [run, headers, refresh]);

  const disable = useCallback((code) => run(async () => {
    await apiRequest('/api/v1/auth/2fa/disable', { method: 'POST', headers: headers(), body: JSON.stringify({ code }) });
    setBackupCodes(null);
    await refresh();
  }), [run, headers, refresh]);

  return { status, setup, backupCodes, busy, error, begin, enable, disable, dismissBackupCodes: () => setBackupCodes(null), cancelSetup: () => setSetup(null) };
}
