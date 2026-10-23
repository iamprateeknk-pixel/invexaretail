import { OfflineWriteError, shouldRefuseOfflineWrite } from './offline-policy.js';
import {
  isAuthSessionPath,
  readPersistedSession,
  writePersistedSession,
} from './session.js';

export const API_BASE = import.meta.env?.VITE_API_BASE || 'https://invexaretail-api-production.up.railway.app';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let refreshInFlight = null;

export async function refreshSessionAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const session = readPersistedSession();
    const response = await fetch(`${API_BASE}/api/v1/auth/refresh-token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    if (!payload?.token) return null;
    writePersistedSession({
      ...session,
      token: payload.token,
      user: payload.user ?? session.user,
    });
    return payload.token;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

const inFlightWrites = new Map();
// A write that failed in a way the user will retry by hand (network drop, timeout, 5xx) keeps its
// X-Mutation-Id for a while, so the server (lib/mutation-idempotency.ts) can return the original
// result instead of posting twice when the first attempt actually did land.
const retainedMutationIds = new Map();
const MUTATION_ID_RETAIN_MS = 60_000;

function newMutationId() {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `web-${uuid}`;
}

/**
 * Identical writes already in flight share one request (a double-click fires the same write twice
 * before React re-renders the disabled button), and every JSON write carries a stable X-Mutation-Id
 * so a retry after an ambiguous failure cannot double-post stock, transfers or counts. Only string
 * bodies are handled (never FormData).
 */
export function apiRequest(path, options = {}, attempt = 0) {
  const method = String(options.method || 'GET').toUpperCase();
  if (attempt !== 0 || method === 'GET' || typeof options.body !== 'string') return performApiRequest(path, options, attempt);
  const key = `${method} ${path} ${options.headers?.Authorization ?? ''} ${options.body}`;
  const existing = inFlightWrites.get(key);
  if (existing) return existing;
  const now = Date.now();
  const retained = retainedMutationIds.get(key);
  const mutationId = retained && retained.expiresAt > now ? retained.id : newMutationId();
  const request = performApiRequest(path, { ...options, headers: { 'X-Mutation-Id': mutationId, ...(options.headers ?? {}) } }, attempt)
    .then((result) => { retainedMutationIds.delete(key); return result; })
    .catch((error) => {
      // 4xx other than "still processing": the server released the claim, so the next try is a new action.
      const definitive = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 408;
      if (definitive) retainedMutationIds.delete(key);
      else retainedMutationIds.set(key, { id: mutationId, expiresAt: Date.now() + MUTATION_ID_RETAIN_MS });
      throw error;
    })
    .finally(() => inFlightWrites.delete(key));
  inFlightWrites.set(key, request);
  return request;
}

async function performApiRequest(path, options = {}, attempt = 0) {
  const method = String(options.method || 'GET').toUpperCase();
  if (shouldRefuseOfflineWrite({ method, onLine: globalThis.navigator?.onLine })) throw new OfflineWriteError();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: options.credentials ?? 'include',
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      if (response.status === 401 && attempt === 0 && !isAuthSessionPath(path)) {
        const nextToken = await refreshSessionAccessToken();
        if (nextToken) {
          return performApiRequest(path, {
            ...options,
            headers: {
              ...(options.headers ?? {}),
              Authorization: `Bearer ${nextToken}`,
            },
          }, 1);
        }
      }
      const errorBody = await response.json().catch(() => ({}));
      throw new ApiError(errorBody.message ?? errorBody.error ?? `Request failed with ${response.status}`, response.status);
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // The web app does not queue writes offline (lib/offline-policy.js): fail clearly, save nothing.
    if (shouldRefuseOfflineWrite({ method, onLine: globalThis.navigator?.onLine })) throw new OfflineWriteError();
    if (error instanceof TypeError) {
      throw new Error('Cannot reach the Invexa API. Check the service health and CORS configuration, then retry.');
    }
    throw error;
  }
}
