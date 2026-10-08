import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';
import { browserWebAuthn, passkeyErrorMessage } from '../lib/passkeys.js';

// Per-screen query for the signed-in user's passkeys plus add / remove. `webauthn` is injectable for tests.
export function usePasskeys({ authToken, webauthn = browserWebAuthn }) {
  const [state, setState] = useState(null); // { configured, passkeys }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const headers = useCallback(() => ({ Authorization: `Bearer ${authToken}` }), [authToken]);

  const refresh = useCallback(async () => {
    if (!authToken) return;
    try {
      setState(await apiRequest('/api/v1/auth/passkeys', { headers: headers() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load passkeys.');
    }
  }, [authToken, headers]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = useCallback(async (action, fallback) => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(passkeyErrorMessage(err, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const add = useCallback((deviceName) => run(async () => {
    const begin = await apiRequest('/api/v1/auth/passkeys/register/options', { method: 'POST', headers: headers(), body: JSON.stringify({}) });
    const response = await webauthn.startRegistration({ optionsJSON: begin.options });
    await apiRequest('/api/v1/auth/passkeys/register/verify', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ challengeToken: begin.challengeToken, response, deviceName: deviceName || undefined }),
    });
    await refresh();
    return true;
  }, 'Could not add the passkey.'), [run, headers, webauthn, refresh]);

  const remove = useCallback((id) => run(async () => {
    await apiRequest(`/api/v1/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() });
    await refresh();
    return true;
  }, 'Could not remove the passkey.'), [run, headers, refresh]);

  return { state, busy, error, add, remove };
}
