import { randomUUID } from 'node:crypto';
import { prisma, resolveDatabaseUrl } from './db.js';

export function evidenceMime(bytes: Buffer): string {
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new Error('Photo must be between 1 byte and 5 MB.');
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  throw new Error('Only JPEG, PNG and WebP photos are supported.');
}

let schema: Promise<unknown> | undefined;
async function ensureSchema() {
  if (!resolveDatabaseUrl()) throw new Error('Durable evidence requires a connected MySQL database.');
  schema ??= prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS TransferEvidence (id VARCHAR(191) PRIMARY KEY, transferId VARCHAR(191) NOT NULL, fileName VARCHAR(191) NOT NULL, mimeType VARCHAR(64) NOT NULL, byteSize INT NOT NULL, uploadedBy VARCHAR(191) NOT NULL, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), contents LONGBLOB NOT NULL, INDEX TransferEvidence_transfer_idx (transferId))'
  ).catch((error) => { schema = undefined; throw error; });
  await schema;
}

export async function saveTransferEvidence(transferId: string, uploadedBy: string, fileName: string, bytes: Buffer) {
  const mimeType = evidenceMime(bytes);
  await ensureSchema();
  const id = randomUUID();
  const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
  await prisma.$executeRawUnsafe(
    'INSERT INTO TransferEvidence (id, transferId, fileName, mimeType, byteSize, uploadedBy, contents) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, transferId, safeName, mimeType, bytes.length, uploadedBy, bytes,
  );
  return { id, transferId, fileName: safeName, mimeType, size: bytes.length };
}

export async function listTransferEvidence(transferId: string) {
  await ensureSchema();
  return prisma.$queryRawUnsafe('SELECT id, transferId, fileName, mimeType, byteSize AS size, createdAt FROM TransferEvidence WHERE transferId = ? ORDER BY createdAt', transferId);
}

export async function readTransferEvidence(transferId: string, id: string) {
  await ensureSchema();
  const rows = await prisma.$queryRawUnsafe<Array<{ mimeType: string; contents: Uint8Array }>>(
    'SELECT mimeType, contents FROM TransferEvidence WHERE transferId = ? AND id = ?', transferId, id,
  );
  return rows[0];
}
