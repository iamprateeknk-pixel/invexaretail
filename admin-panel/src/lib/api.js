export const API_BASE = import.meta.env.VITE_API_BASE || 'https://invexaretail.onrender.com';
export const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL || 'https://control.invexaretail.com';

export async function controlRequest(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
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
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  }
  return payload;
}
