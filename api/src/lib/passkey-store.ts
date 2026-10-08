// Passkeys (WebAuthn) credential storage. Dual-mode like lib/two-factor-store.ts: Postgres in database mode,
// in-memory otherwise. Only public material is stored (credential id, COSE public key, counter).
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';

export type PasskeyRecord = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

const memory = new Map<string, PasskeyRecord>();
let memorySeq = 0;

const parseTransports = (raw: string): string[] => {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};

type Row = {
  id: string; userId: string; credentialId: string; publicKey: Uint8Array | Buffer; counter: number;
  transports: string; deviceName: string | null; createdAt: Date; lastUsedAt: Date | null;
};
const fromRow = (row: Row): PasskeyRecord => ({ ...row, publicKey: new Uint8Array(row.publicKey), transports: parseTransports(row.transports) });

export async function listPasskeys(userId: string): Promise<PasskeyRecord[]> {
  if (databaseEnabled) {
    return (await prisma.passkeyCredential.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })).map(fromRow);
  }
  return [...memory.values()].filter((row) => row.userId === userId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRecord | null> {
  if (databaseEnabled) {
    const row = await prisma.passkeyCredential.findUnique({ where: { credentialId } });
    return row ? fromRow(row) : null;
  }
  return [...memory.values()].find((row) => row.credentialId === credentialId) ?? null;
}

/** Returns null when this credential id is already registered (to anyone). */
export async function addPasskey(input: {
  userId: string; credentialId: string; publicKey: Uint8Array; counter: number; transports: string[]; deviceName?: string | null;
}): Promise<PasskeyRecord | null> {
  if (await findPasskeyByCredentialId(input.credentialId)) return null;
  if (databaseEnabled) {
    try {
      const row = await prisma.passkeyCredential.create({ data: {
        userId: input.userId, credentialId: input.credentialId, publicKey: Buffer.from(input.publicKey), counter: input.counter,
        transports: JSON.stringify(input.transports), deviceName: input.deviceName ?? null,
      } });
      return fromRow(row);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return null;
      throw error;
    }
  }
  const record: PasskeyRecord = {
    id: `pk-${++memorySeq}`, userId: input.userId, credentialId: input.credentialId, publicKey: input.publicKey, counter: input.counter,
    transports: input.transports, deviceName: input.deviceName ?? null, createdAt: new Date(), lastUsedAt: null,
  };
  memory.set(record.id, record);
  return record;
}

/**
 * Records a successful sign-in. The counter is advanced only if it moves forward, in one conditional update, so two
 * concurrent assertions cannot both succeed with the same counter. Returns false when it lost that race or the
 * counter went backwards (a cloned authenticator).
 */
export async function recordPasskeyUse(passkey: PasskeyRecord, newCounter: number): Promise<boolean> {
  const forward = newCounter > passkey.counter;
  // An authenticator without a counter reports 0 forever; that is accepted, a counter that goes backwards is not.
  if (!forward && !(newCounter === 0 && passkey.counter === 0)) return false;
  if (databaseEnabled) {
    const result = await prisma.passkeyCredential.updateMany({
      where: { id: passkey.id, counter: passkey.counter },
      data: { counter: newCounter, lastUsedAt: new Date() },
    });
    return result.count === 1;
  }
  const row = memory.get(passkey.id);
  if (!row || row.counter !== passkey.counter) return false;
  row.counter = newCounter;
  row.lastUsedAt = new Date();
  return true;
}

export async function deletePasskey(userId: string, id: string): Promise<boolean> {
  if (databaseEnabled) {
    return (await prisma.passkeyCredential.deleteMany({ where: { id, userId } })).count === 1;
  }
  const row = memory.get(id);
  if (!row || row.userId !== userId) return false;
  return memory.delete(id);
}

export function resetPasskeysForTests(): void {
  memory.clear();
}
