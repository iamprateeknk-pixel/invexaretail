export function publicApiOrigin(value, { build = false } = {}) {
  const input = value?.trim();
  if (!input && !build) return '';

  const url = URL.parse(input ?? '');
  const origin = build ? /^https:\/\/[^\s/?#\\@]+\/?$/i : /^https?:\/\/[^\s/?#\\@]+\/?$/i;
  if (!url || !origin.test(input)) {
    throw new Error(`VITE_API_BASE must be an explicit ${build ? 'HTTPS' : 'HTTP or HTTPS'} origin without credentials, path, query, or fragment.`);
  }

  return url.origin;
}
