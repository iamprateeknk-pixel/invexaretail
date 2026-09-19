import { addSyncAction } from '../offlineStore';
import { classifyOfflineAction } from './offline-action.js';
import {
  isAuthSessionPath,
  readPersistedSession,
  writePersistedSession,
} from './session.js';

export const API_BASE = import.meta.env?.VITE_API_BASE || 'https://invexaretail-h1ps.onrender.com';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);

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
    const refreshToken = session?.refreshToken;
    if (!refreshToken) return null;
    const response = await fetch(`${API_BASE}/api/v1/auth/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    if (!payload?.token) return null;
    writePersistedSession({
      ...session,
      token: payload.token,
      refreshToken: payload.refreshToken || refreshToken,
      user: payload.user ?? session.user,
    });
    return payload.token;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function apiRequest(path, options = {}, attempt = 0) {
  const method = String(options.method || 'GET').toUpperCase();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
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
          return apiRequest(path, {
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
    if (globalThis.navigator?.onLine === false && MUTATING_METHODS.has(method)) {
      await addSyncAction({
        type: classifyOfflineAction(path),
        endpoint: path,
        method,
        data: options.body ? JSON.parse(options.body) : {},
      });
      throw new Error('Offline: Action queued for sync when back online');
    }
    if (error instanceof TypeError) {
      throw new Error('Cannot reach the Invexa API. Check the service health and CORS configuration, then retry.');
    }
    throw error;
  }
}
