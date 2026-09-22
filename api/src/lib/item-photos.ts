import { prisma, resolveDatabaseUrl } from './db.js';
import { evidenceMime } from './transfer-evidence.js';

// Blueprint P1 "Item media": multi-image item photos with a primary
// thumbnail. Same FK-free Bytes-column pattern as TransferEvidence - no
// object storage (R2/S3) dependency required to self-host.
export async function saveItemPhoto(itemId: string, uploadedBy: string, fileName: string, bytes: Buffer, makePrimary = false) {
  if (!resolveDatabaseUrl()) throw new Error('Durable item photos require a connected database.');
  const mimeType = evidenceMime(bytes);
  const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
  const existingCount = await prisma.itemPhoto.count({ where: { itemId } });
  const isPrimary = makePrimary || existingCount === 0;
  if (isPrimary) {
    await prisma.itemPhoto.updateMany({ where: { itemId }, data: { isPrimary: false } });
  }
  const row = await prisma.itemPhoto.create({
    data: { itemId, uploadedBy, fileName: safeName, mimeType, byteSize: bytes.length, isPrimary, contents: Uint8Array.from(bytes) },
  });
  return { id: row.id, itemId, fileName: safeName, mimeType, size: bytes.length, isPrimary };
}

export async function listItemPhotos(itemId: string) {
  const rows = await prisma.itemPhoto.findMany({
    where: { itemId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, itemId: true, fileName: true, mimeType: true, byteSize: true, isPrimary: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, size: row.byteSize }));
}

export async function readItemPhoto(itemId: string, id: string) {
  const row = await prisma.itemPhoto.findFirst({ where: { itemId, id }, select: { mimeType: true, contents: true } });
  return row ? { mimeType: row.mimeType, contents: row.contents } : undefined;
}

export async function deleteItemPhoto(itemId: string, id: string) {
  await prisma.itemPhoto.deleteMany({ where: { itemId, id } });
  const remainingPrimary = await prisma.itemPhoto.count({ where: { itemId, isPrimary: true } });
  if (remainingPrimary === 0) {
    const next = await prisma.itemPhoto.findFirst({ where: { itemId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (next) await prisma.itemPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
}
