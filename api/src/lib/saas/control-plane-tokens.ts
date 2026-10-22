import { createHmac } from 'node:crypto';
import { ControlPlaneError, type ControlTokenPayload } from './control-plane.js';

function jwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  return 'dev-secret-key-change-in-production';
}

export function signControlToken(payload: Omit<ControlTokenPayload, 'issuedAt' | 'expiresAt' | 'tokenType'> & {
  ttlSeconds?: number;
  tokenType?: 'access' | 'refresh';
}): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokenType = payload.tokenType ?? 'access';
  const ttlSeconds = payload.ttlSeconds ?? (tokenType === 'refresh' ? 60 * 60 * 24 * 7 : 60 * 60);
  const body: ControlTokenPayload = {
    ...payload,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    tokenType,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signature = createHmac('sha256', jwtSecret()).update(`${header}.${encoded}`).digest('base64url');
  return `${header}.${encoded}.${signature}`;
}

export function verifyControlToken(token: string, expectedType: 'access' | 'refresh' = 'access'): ControlTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new ControlPlaneError('Invalid control token', 'INVALID_TOKEN', 401);
  }
  const [header, encoded, signature] = parts;
  const expected = createHmac('sha256', jwtSecret()).update(`${header}.${encoded}`).digest('base64url');
  if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) {
    throw new ControlPlaneError('Invalid control token', 'INVALID_TOKEN', 401);
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ControlTokenPayload;
  if (payload.expiresAt < Math.floor(Date.now() / 1000)) {
    throw new ControlPlaneError('Control token expired', 'TOKEN_EXPIRED', 401);
  }
  if ((payload.tokenType ?? 'access') !== expectedType) {
    throw new ControlPlaneError('Wrong token type', 'INVALID_TOKEN', 401);
  }
  return payload;
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
