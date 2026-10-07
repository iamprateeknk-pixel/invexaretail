// A native app that is already signed in opens this workspace at `#/handoff?code=<one-time code>`
// instead of showing a second login. The code travels in the URL fragment (never sent to a server or
// a referrer), is removed from the address bar immediately, and is exchanged once for a normal session.

export const WEB_HANDOFF_EXCHANGE_PATH = '/api/v1/auth/web-handoff/exchange';

/** The one-time code in `#/handoff?code=...`, or '' when the hash is anything else. */
export function handoffCodeFromHash(hash = '') {
  const text = String(hash).replace(/^#/, '');
  if (!/^\/?handoff(\?|$)/.test(text)) return '';
  const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : '';
  const code = new URLSearchParams(query).get('code') ?? '';
  return /^[A-Za-z0-9_-]{20,200}$/.test(code) ? code : '';
}

/** The URL with the handoff fragment replaced by the app root, so the code is not left in history. */
export function urlWithoutHandoff(pathname = '/', search = '') {
  return `${pathname}${search}#/`;
}
