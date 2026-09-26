import { randomBytes } from 'node:crypto';

// PO-/JOB- numbers used to be `PREFIX-${Date.now().toString().slice(-8)}`: the last
// 8 digits of the millisecond clock repeat every ~27.8 hours, and the column is
// globally unique across every tenant, so two documents created at the same
// moment-of-day (a day apart, or by two companies) collided and the second create
// failed with a unique-constraint error (audit P1-7). A date stamp plus 8 random
// characters cannot repeat within a day in practice and stays human-readable.
const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O

export function newDocumentNumber(prefix: string, now: Date = new Date()): string {
  const stamp = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  const suffix = [...randomBytes(8)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${prefix}-${stamp}-${suffix}`;
}
