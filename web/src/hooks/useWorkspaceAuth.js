import { API_BASE, apiRequest, refreshSessionAccessToken } from '../lib/api-client';
import {
  accessTokenNeedsRefresh,
  clearPersistedSession,
  readPersistedSession,
  shouldClearSessionOnHydrateFailure,
  subscribePersistedSession,
  writePersistedSession,
} from '../lib/session';
import { purgeLegacyOfflineQueue } from '../offlineStore';
import { isTwoFactorChallenge, normalizeTwoFactorCode } from '../lib/two-factor';
import { WEB_HANDOFF_EXCHANGE_PATH, handoffCodeFromHash, urlWithoutHandoff } from '../lib/web-handoff';
import { useEffect, useState } from 'react';

export function useWorkspaceAuth({ loadAppData, onLogout, setLoading, addNotification }) {
  // Opened by the native app with a one-time code: whatever session this browser held belongs to someone else.
  const [session, setSession] = useState(() => (handoffCodeFromHash(window.location.hash) ? null : readPersistedSession()));
  const authToken = session?.token ?? '';
  const role = session?.user?.role ?? null;
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginOtp, setLoginOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpNotice, setOtpNotice] = useState('');
  const [devOtpCode, setDevOtpCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  // Set when the server accepted the first factor but wants an authenticator or backup code.
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  function persistSession(next) {
    writePersistedSession(next);
    setSession(next);
    return next;
  }

  function normalizedLoginEmail() {
    return loginEmail.trim().toLowerCase();
  }

  function resetLoginForm() {
    setLoginEmail('');
    setLoginPassword('');
    setLoginOtp('');
    setOtpSent(false);
    setOtpNotice('');
    setDevOtpCode('');
    setAuthError('');
    setTwoFactorToken('');
    setTwoFactorCode('');
  }

  async function establishSession(login) {
    persistSession({
      token: login.token,
      user: login.user,
    });
    setLoading(true);
    try {
      await loadAppData(login.token, login.user.role);
    } finally {
      setLoading(false);
    }
    setLoginPassword('');
    setLoginOtp('');
    setOtpSent(false);
    setOtpNotice('');
    setDevOtpCode('');
  }

  async function handleLogin(event) {
    event?.preventDefault?.();
    setAuthLoading(true);
    setAuthError('');

    try {
      const login = await apiRequest('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedLoginEmail(), password: loginPassword }),
      });
      if (isTwoFactorChallenge(login)) { setTwoFactorToken(login.challengeToken); return; }
      await establishSession(login);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Invalid email or password.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSendOtp(event) {
    event?.preventDefault?.();
    setAuthLoading(true);
    setAuthError('');
    setOtpNotice('');
    setDevOtpCode('');

    try {
      const result = await apiRequest('/api/v1/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedLoginEmail() }),
      });
      setOtpSent(true);
      setLoginOtp('');
      setOtpNotice(result.message || 'OTP sent to your email.');
      if (typeof result.otpCode === 'string' && result.otpCode) {
        setDevOtpCode(result.otpCode);
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not send a sign-in code.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleVerifyOtp(event) {
    event?.preventDefault?.();
    setAuthLoading(true);
    setAuthError('');

    try {
      const login = await apiRequest('/api/v1/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedLoginEmail(), otpCode: loginOtp.trim() }),
      });
      if (isTwoFactorChallenge(login)) { setTwoFactorToken(login.challengeToken); return; }
      await establishSession(login);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Invalid or expired code.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleVerifyTwoFactor(event) {
    event?.preventDefault?.();
    setAuthLoading(true);
    setAuthError('');
    try {
      const login = await apiRequest('/api/v1/auth/2fa/verify-login', {
        method: 'POST',
        body: JSON.stringify({ challengeToken: twoFactorToken, code: normalizeTwoFactorCode(twoFactorCode) }),
      });
      setTwoFactorToken('');
      setTwoFactorCode('');
      await establishSession(login);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'That code was not accepted.');
    } finally {
      setAuthLoading(false);
    }
  }

  function cancelTwoFactor() {
    setTwoFactorToken('');
    setTwoFactorCode('');
    setAuthError('');
  }

  async function handleLogout() {
    try {
      await apiRequest('/api/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch {
      // Local sign-out must succeed even if the API is unreachable.
    }
    clearPersistedSession();
    setSession(null);
    resetLoginForm();
    onLogout?.();
  }

  // Signed-in native app -> this workspace without a second login (see lib/web-handoff.js).
  useEffect(() => {
    const code = handoffCodeFromHash(window.location.hash);
    if (!code) return undefined;
    window.history.replaceState(null, '', urlWithoutHandoff(window.location.pathname, window.location.search));
    // Deliberately not cancellable: the code is one-time and already removed from the URL, so a
    // re-run of this effect (React strict mode, a remount) could never exchange it a second time.
    (async () => {
      setAuthLoading(true);
      try {
        const login = await apiRequest(WEB_HANDOFF_EXCHANGE_PATH, { method: 'POST', body: JSON.stringify({ code }) });
        await establishSession(login);
      } catch {
        setAuthError('Could not open the workspace from the app. Please sign in.');
      } finally {
        setAuthLoading(false);
      }
    })();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => subscribePersistedSession((next) => {
    setSession(next);
  }), []);

  useEffect(() => {
    if (!session?.token) return undefined;
    let cancelled = false;

    async function hydrate() {
      setLoading(true);
      try {
        let token = session.token;
        if (accessTokenNeedsRefresh(token)) {
          const refreshed = await refreshSessionAccessToken();
          if (refreshed) token = refreshed;
        }
        if (cancelled) return;
        await loadAppData(token, session.user?.role ?? role);
      } catch (error) {
        if (cancelled) return;
        const refreshed = Number(error?.status) === 401 ? await refreshSessionAccessToken() : null;
        if (refreshed && !cancelled) {
          try {
            await loadAppData(refreshed, session.user?.role ?? role);
            return;
          } catch (retryError) {
            if (!shouldClearSessionOnHydrateFailure(retryError, false) || cancelled) return;
          }
        }
        if (!shouldClearSessionOnHydrateFailure(error, Boolean(refreshed))) return;
        await handleLogout();
        setAuthError('Your account is no longer active. Please sign in again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session?.token) return undefined;
    const timer = window.setInterval(() => {
      const current = readPersistedSession();
      if (current?.token && accessTokenNeedsRefresh(current.token)) {
        refreshSessionAccessToken();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [session?.token]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        console.log('Service Worker registered:', registration);
        if (registration.sync) {
          console.log('Background Sync API supported');
        }
      }).catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
    }
  }, []);

  useEffect(() => {
    // Older versions kept one global offline write queue that could replay under another user.
    // It is discarded once, with a notice, rather than ever being replayed.
    purgeLegacyOfflineQueue().then((discarded) => {
      if (discarded > 0) {
        addNotification('Offline changes discarded', `${discarded} unsent change${discarded === 1 ? '' : 's'} from an older version could not be tied to a user and were removed. Please re-enter them if needed.`, 'warning');
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    session,
    setSession,
    authToken,
    role,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginOtp,
    setLoginOtp,
    otpSent,
    otpNotice,
    devOtpCode,
    authError,
    setAuthError,
    authLoading,
    handleLogin,
    handleSendOtp,
    handleVerifyOtp,
    twoFactorToken,
    twoFactorCode,
    setTwoFactorCode,
    handleVerifyTwoFactor,
    cancelTwoFactor,
    handleLogout,
  };
}
