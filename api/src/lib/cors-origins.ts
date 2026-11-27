export const REQUIRED_WEB_ORIGINS = [
  'https://invexaretail.com',
  'https://www.invexaretail.com',
  'https://control.invexaretail.com',
  // Control Plane (admin-panel), served by its own Nginx container on the cloud host.
  'https://admin.invexaretail.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function normalizeOrigin(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    return new URL(candidate).origin.toLowerCase();
  } catch {
    return candidate.replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Hostinger env can override ALLOWED_ORIGINS and accidentally drop the live
 * website. Always keep normalized production origins, then add extras.
 */
export function resolveAllowedOrigins(envValue?: string | null): string[] {
  return [...new Set(
    [...REQUIRED_WEB_ORIGINS, ...String(envValue ?? '').split(',')]
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  )];
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins = resolveAllowedOrigins(process.env.ALLOWED_ORIGINS)): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && allowedOrigins.includes(normalized));
}
