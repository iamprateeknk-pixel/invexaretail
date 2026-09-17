import { API_BASE, apiRequest, refreshSessionAccessToken } from '../lib/api-client';
import {
  accessTokenNeedsRefresh,
  clearPersistedSession,
  readPersistedSession,
  shouldClearSessionOnHydrateFailure,
  subscribePersistedSession,
  writePersistedSession,
} from '../lib/session';
import { initDB, getPendingSyncActions, removeSyncAction, updateSyncActionRetries } from '../offlineStore';
import { useEffect, useState } from 'react';

export function useWorkspaceAuth({ loadAppData, onLogout, setLoading, addNotification }) {
  const [session, setSession] = useState(() => readPersistedSession());
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
  }

  async function establishSession(login) {
    persistSession({
      token: login.token,
      refreshToken: login.refreshToken,
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
      await establishSession(login);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Invalid or expired code.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    const refreshToken = readPersistedSession()?.refreshToken ?? session?.refreshToken;
    try {
      await apiRequest('/api/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Local sign-out must succeed even if the API is unreachable.
    }
    clearPersistedSession();
    setSession(null);
    resetLoginForm();
    onLogout?.();
  }

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
    if (!session?.refreshToken) return undefined;
    const timer = window.setInterval(() => {
      const current = readPersistedSession();
      if (current?.token && accessTokenNeedsRefresh(current.token)) {
        refreshSessionAccessToken();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [session?.refreshToken]);

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
    if (!authToken) return;

    const handleOnline = async () => {
      addNotification('System', 'Back online - syncing pending actions...', 'info');
      try {
        await initDB();
        const pendingActions = await getPendingSyncActions();

        for (const action of pendingActions) {
          if (action.retries > 3) continue;

          try {
            const latestToken = readPersistedSession()?.token ?? authToken;
            const response = await fetch(`${API_BASE}${action.endpoint}`, {
              method: action.method,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${latestToken}`,
              },
              body: JSON.stringify(action.data),
            });

            if (response.ok) {
              await removeSyncAction(action.id);
              addNotification('Sync Complete', `${action.type} action synced successfully`, 'success');
            } else {
              await updateSyncActionRetries(action.id, action.retries + 1);
            }
          } catch {
            await updateSyncActionRetries(action.id, action.retries + 1);
          }
        }

        const remainingActions = await getPendingSyncActions();
        if (remainingActions.length === 0) {
          addNotification('All synced', 'All pending actions have been synced', 'success');
        }
      } catch (error) {
        console.error('Error syncing pending actions:', error);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [authToken, addNotification]);

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
    handleLogout,
  };
}
