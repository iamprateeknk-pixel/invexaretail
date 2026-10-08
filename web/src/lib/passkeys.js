import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

// The browser-side half of passkeys. The server (api/src/lib/passkeys.ts) owns every check; this only runs the
// authenticator prompt. Kept behind this seam so tests can pass a fake instead of navigator.credentials.
export const browserWebAuthn = { startRegistration, startAuthentication };

export function passkeysSupported() {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

// The user closing the prompt, or the device refusing it, is a normal outcome, not a failure to report loudly.
export function passkeyErrorMessage(error, fallback) {
  const name = error && typeof error === 'object' ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'The passkey prompt was cancelled or timed out.';
  if (name === 'InvalidStateError') return 'This device already has a passkey for your account.';
  return error instanceof Error && error.message ? error.message : fallback;
}
