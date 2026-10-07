import { API_BASE } from '../lib/api-client.js';

const STORAGE_KEY = 'invexa_control_session';

export { isControlPlaneDeployment, isControlPlaneHash, isControlPlaneRoute } from './control-route.js';

// The control session is tab-scoped (sessionStorage): it ends with the tab instead of lingering in
// localStorage, and a leftover entry from the old localStorage design is removed on first read.
export function readControlSession() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeControlSession(session) {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable: the session still works for this page load.
  }
  return session;
}

export function clearControlSession() {
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** The one-time handoff code in `#/control?code=...`, or '' when there is none. */
export function handoffCodeFromHash(hash = globalThis.location?.hash ?? '') {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(query).get('code') ?? '';
}

// The Cloudflare admin-panel worker locks a company, then redirects here with a short one-time
// code in the URL fragment (never the session itself). Scrub the code from the address bar first,
// then exchange it once with the API for the session. A used, expired or invented code yields null.
export async function exchangeSessionHandoff(hash = globalThis.location?.hash ?? '') {
  const code = handoffCodeFromHash(hash);
  if (!code) return null;
  const nextHash = hash.split('?')[0];
  globalThis.history?.replaceState?.(null, '', `${globalThis.location.pathname}${globalThis.location.search}${nextHash}`);
  try {
    const { session } = await controlRequest('/control/v1/sessions/handoff/exchange', { method: 'POST', body: { code } });
    return session ? writeControlSession(session) : null;
  } catch {
    return null;
  }
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
