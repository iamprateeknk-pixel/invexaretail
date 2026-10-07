import { createHash, randomBytes } from 'node:crypto';

// Plan Area D WP2: the admin panel and the Control Plane UI are different origins, so a locked
// company session has to cross from one to the other. It used to ride in the URL fragment as the
// whole session object (tokens included), which ends up in history, screenshots and referrers.
// Now only a short random code travels in the URL: it is single-use, expires in a minute, and is
// stored here only as a hash. Exchanging it returns the session once, then the code is gone.
//
// The store is in memory, like the control-plane sessions themselves: a handoff must complete on
// the instance that issued it, which holds for the single API replica this runs as today.

export const HANDOFF_TTL_MS = 60_000;
const MAX_PENDING = 500;

/** What a code may be redeemed for. A code minted for one purpose is useless for the other. */
export type HandoffPurpose = 'control' | 'web';

type Entry = { session: unknown; expiresAt: number; purpose: HandoffPurpose };

const pending = new Map<string, Entry>();

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

function sweep(now: number): void {
  for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
}

/** Stores the session and returns the one-time code that redeems it. */
export function createHandoff(session: unknown, now = Date.now(), purpose: HandoffPurpose = 'control'): { code: string; expiresInSeconds: number } {
  sweep(now);
  if (pending.size >= MAX_PENDING) {
    // Drop the oldest rather than refusing: a flood must not lock the operator out of the UI.
    const oldest = pending.keys().next().value;
    if (oldest) pending.delete(oldest);
  }
  const code = randomBytes(32).toString('base64url');
  pending.set(hashCode(code), { session, expiresAt: now + HANDOFF_TTL_MS, purpose });
  return { code, expiresInSeconds: HANDOFF_TTL_MS / 1000 };
}

/** Redeems a code exactly once. Unknown, used and expired codes are indistinguishable (null). */
export function redeemHandoff(code: string, now = Date.now(), purpose: HandoffPurpose = 'control'): unknown | null {
  if (typeof code !== 'string' || code.length < 20 || code.length > 200) return null;
  const key = hashCode(code);
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
