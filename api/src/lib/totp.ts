// Phase 5: TOTP (RFC 6238) for optional two-factor sign-in. The only crypto
// primitives used are node:crypto's HMAC-SHA1 (the RFC's algorithm), its CSPRNG
// and AES-256-GCM with a random IV for secrets at rest - nothing hand-rolled
// (AGENTS.md prohibited pattern #5). The base32 codec is encoding, not crypto.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 character.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpStepFor(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code for one time step (RFC 4226 dynamic truncation). */
export function totpCodeForStep(secret: string, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Returns the matched time step, or null. Accepts +/- `window` steps for clock
 * drift. A step at or below `afterStep` is rejected so one code cannot be used
 * twice (replay protection) - the caller persists the returned step.
 */
export function verifyTotp(secret: string, code: string, options: { timeMs?: number; window?: number; afterStep?: number } = {}): number | null {
  const submitted = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(submitted)) return null;
  const window = options.window ?? 1;
  const current = totpStepFor(options.timeMs ?? Date.now());
  const submittedBuffer = Buffer.from(submitted);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step += 1) {
    if (step <= (options.afterStep ?? 0)) continue;
    const expected = Buffer.from(totpCodeForStep(secret, step));
    // Compare every candidate (no early exit) with a constant-time comparison.
    if (crypto.timingSafeEqual(expected, submittedBuffer) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(accountEmail: string, secret: string, issuer = 'Invexa Retail'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// --- secrets at rest ------------------------------------------------------

export class TotpNotConfiguredError extends Error {
  constructor() {
    super('Two-factor sign-in is not configured on this server (TOTP_ENCRYPTION_KEY).');
    this.name = 'TotpNotConfiguredError';
  }
}

function encryptionKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY?.trim();
  if (!raw) throw new TotpNotConfiguredError();
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new TotpNotConfiguredError();
  return key;
}

export function totpIsConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/** AES-256-GCM, random 96-bit IV per secret; stored as iv.tag.ciphertext (base64url). */
export function encryptTotpSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptTotpSecret(stored: string): string {
  const [iv, tag, ciphertext] = stored.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
