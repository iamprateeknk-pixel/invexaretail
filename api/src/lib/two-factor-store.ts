// Phase 5: persistence and verification for optional TOTP two-factor sign-in.
// Secrets are AES-256-GCM encrypted at rest (lib/totp.ts); backup codes are
// stored only as HMAC hashes and each works once. Dual-mode like
// lib/session-store.ts: Postgres in database mode, in-memory otherwise.
import crypto from 'node:crypto';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from './totp.js';

const BACKUP_CODE_COUNT = 8;

function pepper(): string {
  return process.env.OTP_PEPPER?.trim() || process.env.JWT_SECRET?.trim() || 'dev-otp-pepper-change-in-production';
}

const hashBackupCode = (code: string) => crypto.createHmac('sha256', pepper()).update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');

/** 10 chars from an unambiguous alphabet, shown as XXXXX-XXXXX. */
function newBackupCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let raw = '';
  for (let i = 0; i < 10; i += 1) raw += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

type TotpRecord = { secretEnc: string; enabledAt: Date | null; lastUsedStep: number; backupCodeHashes: string[] };
const memory = new Map<string, TotpRecord>();

async function load(userId: string): Promise<TotpRecord | null> {
  if (databaseEnabled) {
    const row = await prisma.userTotp.findUnique({ where: { userId } });
    return row ? { secretEnc: row.secretEnc, enabledAt: row.enabledAt, lastUsedStep: row.lastUsedStep, backupCodeHashes: JSON.parse(row.backupCodeHashes) as string[] } : null;
  }
  return memory.get(userId) ?? null;
}

async function save(userId: string, record: TotpRecord): Promise<void> {
  if (databaseEnabled) {
    const data = { secretEnc: record.secretEnc, enabledAt: record.enabledAt, lastUsedStep: record.lastUsedStep, backupCodeHashes: JSON.stringify(record.backupCodeHashes) };
    await prisma.userTotp.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return;
  }
  memory.set(userId, record);
}

export async function twoFactorStatus(userId: string): Promise<{ enabled: boolean; pendingSetup: boolean; backupCodesRemaining: number }> {
  const record = await load(userId);
  return { enabled: Boolean(record?.enabledAt), pendingSetup: Boolean(record && !record.enabledAt), backupCodesRemaining: record?.enabledAt ? record.backupCodeHashes.length : 0 };
}

export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  return (await twoFactorStatus(userId)).enabled;
}

/** Starts (or restarts) enrolment. Refuses when two-factor is already on - disable it first. */
export async function beginEnrollment(userId: string): Promise<{ secret: string } | { alreadyEnabled: true }> {
  const existing = await load(userId);
  if (existing?.enabledAt) return { alreadyEnabled: true };
  const secret = generateTotpSecret();
  await save(userId, { secretEnc: encryptTotpSecret(secret), enabledAt: null, lastUsedStep: 0, backupCodeHashes: [] });
  return { secret };
}

/** Confirms enrolment with a first valid code; returns the backup codes once, in the clear. */
export async function confirmEnrollment(userId: string, code: string): Promise<{ backupCodes: string[] } | null> {
  const record = await load(userId);
  if (!record || record.enabledAt) return null;
  const step = verifyTotp(decryptTotpSecret(record.secretEnc), code);
  if (step === null) return null;
  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
  await save(userId, { ...record, enabledAt: new Date(), lastUsedStep: step, backupCodeHashes: backupCodes.map(hashBackupCode) });
  return { backupCodes };
}

/**
 * Checks a second factor at sign-in: a TOTP code (each step usable once, claimed atomically
 * in the database) or an unused backup code (consumed on success).
 */
export async function verifySecondFactor(userId: string, code: string): Promise<'totp' | 'backup' | null> {
  const record = await load(userId);
  if (!record?.enabledAt) return null;
  const step = verifyTotp(decryptTotpSecret(record.secretEnc), code, { afterStep: record.lastUsedStep });
  if (step !== null) {
    if (databaseEnabled) {
      const claimed = await prisma.userTotp.updateMany({ where: { userId, lastUsedStep: { lt: step } }, data: { lastUsedStep: step } });
      return claimed.count === 1 ? 'totp' : null;
    }
    record.lastUsedStep = step;
    return 'totp';
  }
  const hash = hashBackupCode(code);
  if (record.backupCodeHashes.includes(hash)) {
    const remaining = record.backupCodeHashes.filter((candidate) => candidate !== hash);
    if (databaseEnabled) {
      const claimed = await prisma.userTotp.updateMany({ where: { userId, backupCodeHashes: JSON.stringify(record.backupCodeHashes) }, data: { backupCodeHashes: JSON.stringify(remaining) } });
      return claimed.count === 1 ? 'backup' : null;
    }
    record.backupCodeHashes = remaining;
    return 'backup';
  }
  return null;
}

export async function disableTwoFactor(userId: string): Promise<void> {
  if (databaseEnabled) {
    await prisma.userTotp.deleteMany({ where: { userId } });
    return;
  }
  memory.delete(userId);
}

export function resetTwoFactorForTests(): void {
  memory.clear();
}
