export const SESSION_STORAGE_KEY = 'invexaretail_session';

export const AUTH_SESSION_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/refresh-token',
  '/api/v1/auth/logout',
  '/api/v1/auth/send-otp',
  '/api/v1/auth/verify-otp',
  '/api/v1/auth/2fa/verify-login',
  '/api/v1/auth/passkeys/login/options',
  '/api/v1/auth/passkeys/login/verify',
  '/control/v1/auth/login',
];

const listeners = new Set();

export function subscribePersistedSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitPersistedSession(session) {
  for (const listener of listeners) listener(session);
}

function storage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readPersistedSession() {
  try {
    const raw = storage()?.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedSession(session) {
  const safeSession = session ? { ...session } : session;
  if (safeSession && typeof safeSession === 'object') delete safeSession.refreshToken;
  storage()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(safeSession));
  emitPersistedSession(safeSession);
  return safeSession;
}

export function clearPersistedSession() {
  storage()?.removeItem(SESSION_STORAGE_KEY);
  emitPersistedSession(null);
}

export function isAuthSessionPath(path) {
  return AUTH_SESSION_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}?`));
}

export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function accessTokenNeedsRefresh(token, skewMs = 60_000, now = Date.now()) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 - now <= skewMs;
}

export function shouldClearSessionOnHydrateFailure(error, refreshed) {
  return Number(error?.status) === 401 && !refreshed;
}
