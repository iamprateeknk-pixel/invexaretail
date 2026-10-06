// Plan P0-SYNC-002 / "Web offline policy decision" (Area I, WP5).
//
// DECISION: the web app does not queue writes offline. The previous queue was a
// single global IndexedDB list replayed with whichever user happened to be signed
// in when the connection returned (cross-account replay), over raw fetch (no token
// refresh), with no idempotency key or conflict handling. Making that safe would
// be a second offline engine; instead writes made while offline fail clearly and
// nothing is saved, and offline stock work belongs in the mobile app, which has
// the identity-bound, exactly-once queue.

export const OFFLINE_WRITE_CODE = 'OFFLINE_WRITE_NOT_SAVED';

export const OFFLINE_WRITE_MESSAGE =
  'You are offline, so this change was not saved. Reconnect and try again. (The web app saves changes only while connected; use the mobile app for offline stock work.)';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class OfflineWriteError extends Error {
  constructor() {
    super(OFFLINE_WRITE_MESSAGE);
    this.name = 'OfflineWriteError';
    this.code = OFFLINE_WRITE_CODE;
  }
}

export function isMutatingMethod(method) {
  return MUTATING_METHODS.has(String(method || 'GET').toUpperCase());
}

/** True when a request must be refused up front because the browser reports no connection. */
export function shouldRefuseOfflineWrite({ method, onLine }) {
  return onLine === false && isMutatingMethod(method);
}
