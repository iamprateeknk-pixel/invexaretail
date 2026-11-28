import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import { controlPlaneDbEnabled } from './control-plane-repository.js';

// Plan Area D WP2: the admin panel and the Control Plane UI are different origins, so a locked
// company session has to cross from one to the other. It used to ride in the URL fragment as the
// whole session object (tokens included), which ends up in history, screenshots and referrers.
// Now only a short random code travels in the URL: it is single-use, expires in a minute, and is
// stored only as a hash. PostgreSQL shares the handoff between API instances. The
// code itself is the random AES-256 key, so the stored payload cannot be decrypted
// using the database alone.

export const HANDOFF_TTL_MS = 60_000;
const MAX_PENDING = 500;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** What a code may be redeemed for. A code minted for one purpose is useless for the other. */
export type HandoffPurpose = 'control' | 'web';

type Entry = { session: unknown; expiresAt: number; purpose: HandoffPurpose };

const pending = new Map<string, Entry>();

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

function sweep(now: number): void {
  for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
}

/** Stores the session and returns the one-time code that redeems it. */
export async function createHandoff(session: unknown, now = Date.now(), purpose: HandoffPurpose = 'control'): Promise<{ code: string; expiresInSeconds: number }> {
  const key = randomBytes(32);
  const code = key.toString('base64url');
  const expiresAt = now + HANDOFF_TTL_MS;
  const codeHash = hashCode(code);
  if (controlPlaneDbEnabled()) {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    await prisma.$transaction([
      prisma.sessionHandoff.deleteMany({ where: { expiresAt: { lte: new Date(now) } } }),
      prisma.sessionHandoff.create({ data: { codeHash, purpose, payload, expiresAt: new Date(expiresAt) } }),
    ]);
    return { code, expiresInSeconds: HANDOFF_TTL_MS / 1000 };
  }
  sweep(now);
  if (pending.size >= MAX_PENDING) {
    // Drop the oldest rather than refusing: a flood must not lock the operator out of the UI.
    const oldest = pending.keys().next().value;
    if (oldest) pending.delete(oldest);
  }
  pending.set(codeHash, { session, expiresAt, purpose });
  return { code, expiresInSeconds: HANDOFF_TTL_MS / 1000 };
}

/** Redeems a code exactly once. Unknown, used and expired codes are indistinguishable (null). */
export async function redeemHandoff(code: string, now = Date.now(), purpose: HandoffPurpose = 'control'): Promise<unknown | null> {
  if (typeof code !== 'string' || !/^[a-z0-9_-]{43}$/i.test(code)) return null;
  const key = hashCode(code);
  if (controlPlaneDbEnabled()) {
    // A single DELETE returns the payload to at most one redeemer across replicas.
    const [row] = await prisma.$queryRaw<Array<{ payload: Uint8Array; expiresAt: Date; purpose: string }>>`
      DELETE FROM "SessionHandoff" WHERE "codeHash" = ${key}
      RETURNING "payload", "expiresAt", "purpose"
    `;
    if (!row || row.expiresAt.getTime() <= now || row.purpose !== purpose) return null;
    const payload = Buffer.from(row.payload);
    try {
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(code, 'base64url'), payload.subarray(0, IV_BYTES));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      const clear = Buffer.concat([decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
      return JSON.parse(clear.toString('utf8'));
    } catch {
      return null;
    }
  }
  const entry = pending.get(key);
  if (!entry) return null;
  // A code is consumed by any redemption attempt, but only the purpose it was minted for succeeds.
  pending.delete(key);
  return entry.expiresAt > now && entry.purpose === purpose ? entry.session : null;
}

export function pendingHandoffCount(): number {
  return pending.size;
}

export function resetHandoffsForTest(): void {
  pending.clear();
}
