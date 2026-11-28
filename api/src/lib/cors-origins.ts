import { isIP } from 'node:net';

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

const productionHosts = new Set([
  ...REQUIRED_WEB_ORIGINS.filter((origin) => origin.startsWith('https:')).map((origin) => new URL(origin).hostname),
  'api.invexaretail.com',
  'invexaretail-api-production.up.railway.app',
  'invexaretail-web.iamprateek-nk.workers.dev',
]);

function stagingOrigin(value: string | undefined, variable: string): string {
  const input = value?.trim() ?? '';
  const url = URL.parse(input);
  const host = url?.hostname.replace(/\.$/, '') ?? '';
  if (!url || !/^https:\/\/[^\s/?#\\@]+\/?$/i.test(input) || !host.includes('.') ||
      isIP(host) || /\.(local|internal|localhost)$/.test(host) || productionHosts.has(host)) {
    throw new Error(variable + ' must be an explicit staging HTTPS origin.');
  }
  return url.origin;
}

export function resolveAllowedOrigins(envValue?: string | null, env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.INVEXA_ENV === 'staging') {
    stagingOrigin(env.PUBLIC_API_URL, 'PUBLIC_API_URL');
    const web = stagingOrigin(env.PUBLIC_WEB_URL, 'PUBLIC_WEB_URL');
    const control = stagingOrigin(env.PUBLIC_CONTROL_URL, 'PUBLIC_CONTROL_URL');
    const origins = new Set(String(envValue ?? '').split(',').map((value) => stagingOrigin(value, 'ALLOWED_ORIGINS')));
    if (!origins.has(web) || !origins.has(control)) {
      throw new Error('ALLOWED_ORIGINS must include PUBLIC_WEB_URL and PUBLIC_CONTROL_URL in staging.');
    }
    return [...origins];
  }
  if (env.INVEXA_ENV !== undefined && env.INVEXA_ENV !== 'production' && env.INVEXA_ENV !== 'development') {
    throw new Error('INVEXA_ENV must be production, staging, or development.');
  }

  // Preserve the live origins when upgrading existing production configurations.
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
