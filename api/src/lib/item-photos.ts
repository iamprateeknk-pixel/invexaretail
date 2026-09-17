import { randomUUID } from 'node:crypto';
import { prisma, resolveDatabaseUrl } from './db.js';
import { evidenceMime } from './transfer-evidence.js';

// Blueprint P1 "Item media": multi-image item photos with a primary
// thumbnail. Same FK-free LONGBLOB pattern as TransferEvidence - no object
// storage (R2/S3) dependency, self-heals on Hostinger shared MySQL.
let schema: Promise<unknown> | undefined;
async function ensureSchema() {
  if (!resolveDatabaseUrl()) throw new Error('Durable item photos require a connected MySQL database.');
  schema ??= prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS ItemPhoto (id VARCHAR(191) PRIMARY KEY, itemId VARCHAR(191) NOT NULL, fileName VARCHAR(191) NOT NULL, mimeType VARCHAR(64) NOT NULL, byteSize INT NOT NULL, isPrimary TINYINT(1) NOT NULL DEFAULT 0, uploadedBy VARCHAR(191) NOT NULL, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), contents LONGBLOB NOT NULL, INDEX ItemPhoto_item_idx (itemId))'
  ).catch((error) => { schema = undefined; throw error; });
  await schema;
}

export async function saveItemPhoto(itemId: string, uploadedBy: string, fileName: string, bytes: Buffer, makePrimary = false) {
  const mimeType = evidenceMime(bytes);
  await ensureSchema();
  const id = randomUUID();
  const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
  const existing = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    'SELECT COUNT(*) AS count FROM ItemPhoto WHERE itemId = ?', itemId,
  );
  const isFirst = Number(existing[0]?.count ?? 0) === 0;
  const isPrimary = makePrimary || isFirst;
  if (isPrimary) {
    await prisma.$executeRawUnsafe('UPDATE ItemPhoto SET isPrimary = 0 WHERE itemId = ?', itemId);
  }
  await prisma.$executeRawUnsafe(
    'INSERT INTO ItemPhoto (id, itemId, fileName, mimeType, byteSize, isPrimary, uploadedBy, contents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, itemId, safeName, mimeType, bytes.length, isPrimary ? 1 : 0, uploadedBy, bytes,
  );
  return { id, itemId, fileName: safeName, mimeType, size: bytes.length, isPrimary };
}

export async function listItemPhotos(itemId: string) {
  await ensureSchema();
  return prisma.$queryRawUnsafe(
    'SELECT id, itemId, fileName, mimeType, byteSize AS size, isPrimary, createdAt FROM ItemPhoto WHERE itemId = ? ORDER BY isPrimary DESC, createdAt',
    itemId,
  );
}

export async function readItemPhoto(itemId: string, id: string) {
  await ensureSchema();
  const rows = await prisma.$queryRawUnsafe<Array<{ mimeType: string; contents: Uint8Array }>>(
    'SELECT mimeType, contents FROM ItemPhoto WHERE itemId = ? AND id = ?', itemId, id,
  );
  return rows[0];
}

export async function deleteItemPhoto(itemId: string, id: string) {
  await ensureSchema();
  await prisma.$executeRawUnsafe('DELETE FROM ItemPhoto WHERE itemId = ? AND id = ?', itemId, id);
  const remaining = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT id FROM ItemPhoto WHERE itemId = ? AND isPrimary = 1', itemId,
  );
  if (remaining.length === 0) {
    const next = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT id FROM ItemPhoto WHERE itemId = ? ORDER BY createdAt LIMIT 1', itemId,
    );
    if (next[0]) await prisma.$executeRawUnsafe('UPDATE ItemPhoto SET isPrimary = 1 WHERE id = ?', next[0].id);
  }
}
