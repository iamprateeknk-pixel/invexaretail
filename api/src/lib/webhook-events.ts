import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_EVENTS = ['stock.low', 'transfer.updated', 'purchase-order.received', 'count.reviewed'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export class WebhookValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

export function isWebhookEvent(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export function parseWebhookEvents(value: unknown): WebhookEventType[] {
  const raw = Array.isArray(value) ? value : [];
  const events = [...new Set(raw.filter((event): event is string => typeof event === 'string').map((event) => event.trim()).filter(isWebhookEvent))];
  if (events.length === 0) {
    throw new WebhookValidationError('Name and at least one event are required.');
  }
  return events;
}

export function parseWebhookName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2) {
    throw new WebhookValidationError('Name and at least one event are required.');
  }
  return name;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isPrivateHost(hostname: string): boolean {
  if (isLoopbackHost(hostname)) return true;
  const host = hostname.toLowerCase();
  if (host === '0.0.0.0' || host.endsWith('.local')) return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function parseWebhookEndpoint(raw: unknown, options?: { allowPrivate?: boolean }): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(String(raw || ''));
  } catch {
    throw new WebhookValidationError('A valid HTTPS webhook URL is required.');
  }
  if (options?.allowPrivate && isLoopbackHost(endpoint.hostname) && (endpoint.protocol === 'http:' || endpoint.protocol === 'https:')) {
    return endpoint;
  }
  if (endpoint.protocol !== 'https:') {
    throw new WebhookValidationError('A valid HTTPS webhook URL is required.');
  }
  if (isPrivateHost(endpoint.hostname)) {
    throw new WebhookValidationError('Webhook URL must be a public HTTPS endpoint.');
  }
  return endpoint;
}

export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function signWebhookBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyWebhookSignature(secret: string, body: string, signature: string): boolean {
  const expected = signWebhookBody(secret, body);
  const actual = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(actual, 'hex');
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

function encryptionKey(): Buffer {
  return createHash('sha256').update(process.env.JWT_SECRET || 'dev-secret-change-in-production').digest();
}

export function encryptWebhookSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
}

export function decryptWebhookSecret(payload: string | null | undefined): string | null {
  if (!payload || !payload.includes('.')) return null;
  const [ivHex, tagHex, dataHex] = payload.split('.');
  if (!ivHex || !tagHex || !dataHex) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
