// ADR-003: persisted, hashed, rotating refresh-token sessions and OTP
// challenges. Replaces the old in-process Map/array store (wiped on
// restart, not shared across replicas, storing raw token/OTP values) with a
// database-backed model in database mode, and an equivalent in-memory
// fallback with the same rotation/reuse-detection logic in memory mode.
import crypto from 'node:crypto';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';

function otpPepper(): string {
  return process.env.OTP_PEPPER?.trim() || process.env.JWT_SECRET?.trim() || 'dev-otp-pepper-change-in-production';
}

function hashOtp(code: string): string {
  return crypto.createHmac('sha256', otpPepper()).update(code).digest('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** crypto.randomInt, not Math.random - Week 3: OTP generation must be CSPRNG. */
export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// ---------------------------------------------------------------------------
// OTP challenges
// ---------------------------------------------------------------------------

export type OtpPurpose = 'LOGIN';
export type OtpVerifyResult = { ok: true } | { ok: false; reason: 'not_found' | 'expired' | 'locked' | 'mismatch' };

type MemoryOtp = { codeHash: string; attempts: number; maxAttempts: number; expiresAt: number; consumed: boolean };
const memoryOtp = new Map<string, MemoryOtp>();
const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

function otpKey(email: string, purpose: OtpPurpose): string {
  return `${email}::${purpose}`;
}

/** Creates a fresh OTP challenge (invalidating any prior unconsumed one for the same email+purpose) and returns the plaintext code to deliver. Never persists the plaintext. */
export async function createOtpChallenge(email: string, purpose: OtpPurpose = 'LOGIN'): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  if (databaseEnabled) {
    await prisma.otpChallenge.deleteMany({ where: { email: normalized, purpose, consumedAt: null } });
    await prisma.otpChallenge.create({ data: { email: normalized, purpose, codeHash, expiresAt, maxAttempts: OTP_MAX_ATTEMPTS } });
  } else {
    memoryOtp.set(otpKey(normalized, purpose), { codeHash, attempts: 0, maxAttempts: OTP_MAX_ATTEMPTS, expiresAt: expiresAt.getTime(), consumed: false });
  }
  return code;
}

export async function clearOtpChallenge(email: string, purpose: OtpPurpose = 'LOGIN'): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (databaseEnabled) {
    await prisma.otpChallenge.deleteMany({ where: { email: normalized, purpose, consumedAt: null } });
    return;
  }
  memoryOtp.delete(otpKey(normalized, purpose));
}

/** Atomic: a code can consume its challenge exactly once, even under concurrent requests. */
export async function verifyOtpChallenge(email: string, code: string, purpose: OtpPurpose = 'LOGIN'): Promise<OtpVerifyResult> {
  const normalized = email.trim().toLowerCase();
  const codeHash = hashOtp(code);
  if (databaseEnabled) {
    return prisma.$transaction(async (tx) => {
      const challenge = await tx.otpChallenge.findFirst({
        where: { email: normalized, purpose, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!challenge) return { ok: false, reason: 'not_found' } as const;
      if (challenge.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' } as const;
      if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: 'locked' } as const;
      if (challenge.codeHash !== codeHash) {
        await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
        return { ok: false, reason: 'mismatch' } as const;
      }
      const claimed = await tx.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) return { ok: false, reason: 'not_found' } as const;
      return { ok: true } as const;
    });
  }
  const entry = memoryOtp.get(otpKey(normalized, purpose));
  if (!entry || entry.consumed) return { ok: false, reason: 'not_found' };
  if (Date.now() > entry.expiresAt) return { ok: false, reason: 'expired' };
  if (entry.attempts >= entry.maxAttempts) return { ok: false, reason: 'locked' };
  if (entry.codeHash !== codeHash) {
    entry.attempts += 1;
    return { ok: false, reason: 'mismatch' };
  }
  entry.consumed = true;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Refresh-token session families
// ---------------------------------------------------------------------------

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionMeta = { deviceInfo?: string; ipAddress?: string; userAgent?: string };
export type IssuedRefreshToken = { token: string; familyId: string; expiresAt: Date };
export type RotateResult =
  | { ok: true; userId: string; companyId: string; issued: IssuedRefreshToken }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' };

type MemorySession = {
  userId: string;
  companyId: string;
  familyId: string;
  status: 'ACTIVE' | 'ROTATED' | 'REVOKED';
  expiresAt: number;
  rotationCounter: number;
};
const memorySessions = new Map<string, MemorySession>(); // keyed by tokenHash

function randomOpaqueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function issueRefreshToken(args: {
  userId: string;
  companyId: string;
  familyId: string;
  rotationCounter: number;
  meta: SessionMeta;
}): Promise<IssuedRefreshToken> {
  const token = randomOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  if (databaseEnabled) {
    await prisma.userSession.create({
      data: {
        userId: args.userId,
        familyId: args.familyId,
        tokenHash,
        status: 'ACTIVE',
        rotationCounter: args.rotationCounter,
        expiresAt,
        deviceInfo: args.meta.deviceInfo ?? null,
        ipAddress: args.meta.ipAddress ?? null,
        userAgent: args.meta.userAgent ?? null,
      },
    });
  } else {
    memorySessions.set(tokenHash, {
      userId: args.userId,
      companyId: args.companyId,
      familyId: args.familyId,
      status: 'ACTIVE',
      expiresAt: expiresAt.getTime(),
      rotationCounter: args.rotationCounter,
    });
  }
  return { token, familyId: args.familyId, expiresAt };
}

/** Starts a brand new session family (e.g. on login). */
export async function createRefreshFamily(userId: string, companyId: string, meta: SessionMeta = {}): Promise<IssuedRefreshToken> {
  const familyId = crypto.randomUUID();
  return issueRefreshToken({ userId, companyId, familyId, rotationCounter: 0, meta });
}

async function revokeFamilyById(familyId: string): Promise<void> {
  if (databaseEnabled) {
    await prisma.userSession.updateMany({ where: { familyId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date() } });
    return;
  }
  for (const session of memorySessions.values()) {
    if (session.familyId === familyId) session.status = 'REVOKED';
  }
}

/**
 * Rotates a refresh token: the presented token must be the current ACTIVE
 * member of its family. Presenting a token that has already been rotated or
 * revoked is treated as token theft/replay - the whole family is revoked so
 * every device sharing it is forced to re-authenticate.
 */
export async function rotateRefreshToken(presentedToken: string, meta: SessionMeta = {}): Promise<RotateResult> {
  const tokenHash = hashToken(presentedToken);
  if (databaseEnabled) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.userSession.findUnique({ where: { tokenHash } });
      if (!row) return { ok: false, reason: 'invalid' } as const;
      if (row.status !== 'ACTIVE') {
        await tx.userSession.updateMany({ where: { familyId: row.familyId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date() } });
        return { ok: false, reason: 'reused' } as const;
      }
      if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' } as const;
      // Atomic claim: only one concurrent rotation attempt can win ACTIVE -> ROTATED.
      const claim = await tx.userSession.updateMany({ where: { id: row.id, status: 'ACTIVE' }, data: { status: 'ROTATED' } });
      if (claim.count !== 1) {
        await tx.userSession.updateMany({ where: { familyId: row.familyId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date() } });
        return { ok: false, reason: 'reused' } as const;
      }
      const user = await tx.user.findUnique({ where: { id: row.userId }, select: { companyId: true } });
      const issued = await issueRefreshToken({ userId: row.userId, companyId: user?.companyId ?? '', familyId: row.familyId, rotationCounter: row.rotationCounter + 1, meta });
      await tx.userSession.update({ where: { id: row.id }, data: { replacedByTokenHash: hashToken(issued.token) } });
      return { ok: true, userId: row.userId, companyId: user?.companyId ?? '', issued } as const;
    });
  }
  const row = memorySessions.get(tokenHash);
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.status !== 'ACTIVE') {
    await revokeFamilyById(row.familyId);
    return { ok: false, reason: 'reused' };
  }
  if (Date.now() > row.expiresAt) return { ok: false, reason: 'expired' };
  row.status = 'ROTATED';
  const issued = await issueRefreshToken({ userId: row.userId, companyId: row.companyId, familyId: row.familyId, rotationCounter: row.rotationCounter + 1, meta });
  return { ok: true, userId: row.userId, companyId: row.companyId, issued };
}

/** Logout: revokes just the presented token's family (this device/session). */
export async function revokeRefreshFamily(presentedToken: string): Promise<void> {
  const tokenHash = hashToken(presentedToken);
  if (databaseEnabled) {
    const row = await prisma.userSession.findUnique({ where: { tokenHash } });
    if (!row) return;
    await revokeFamilyById(row.familyId);
    return;
  }
  const row = memorySessions.get(tokenHash);
  if (!row) return;
  await revokeFamilyById(row.familyId);
}

/** "Sign out everywhere": revokes every session family for this user. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  if (databaseEnabled) {
    await prisma.userSession.updateMany({ where: { userId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date() } });
    return;
  }
  for (const session of memorySessions.values()) {
    if (session.userId === userId) session.status = 'REVOKED';
  }
}

export function resetSessionStoreForTests(): void {
  memorySessions.clear();
  memoryOtp.clear();
}
