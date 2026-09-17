import { API_BASE } from '../lib/api-client.js';

const STORAGE_KEY = 'invexa_control_session';

export { isControlPlaneDeployment, isControlPlaneHash, isControlPlaneRoute } from './control-route.js';

export function readControlSession() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeControlSession(session) {
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearControlSession() {
  globalThis.localStorage?.removeItem(STORAGE_KEY);
}

// The Cloudflare admin-panel worker locks a company, then hands the session
// off by redirecting here with it encoded in the URL fragment (never sent to
// a server, unlike a query string). Pick it up once, persist it locally, and
// scrub it from the address bar so it doesn't linger in history.
export function consumeSessionHandoff(hash = globalThis.location?.hash ?? '') {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const raw = new URLSearchParams(query).get('session');
  if (!raw) return null;
  let session = null;
  try {
    session = JSON.parse(raw);
    writeControlSession(session);
  } catch {
    session = null;
  }
  const nextHash = hash.split('?')[0];
  globalThis.history?.replaceState?.(null, '', `${globalThis.location.pathname}${globalThis.location.search}${nextHash}`);
  return session;
}

export async function controlRequest(path, { token, method = 'GET', body } = {}) {
  const url = method === 'GET'
    ? `${API_BASE}${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`
    : `${API_BASE}${path}`;
  const response = await fetch(url, {
    method,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}
