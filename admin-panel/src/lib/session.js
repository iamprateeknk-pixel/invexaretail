const STORAGE_KEY = 'invexa_control_session';

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
