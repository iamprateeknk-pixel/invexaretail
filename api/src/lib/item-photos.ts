import { randomUUID } from 'node:crypto';
import { prisma, resolveDatabaseUrl } from './db.js';
import { evidenceMime } from './transfer-evidence.js';

function requireDatabase(): void {
  if (!resolveDatabaseUrl()) throw new Error('Durable item photos require a connected PostgreSQL database.');
}

export async function saveItemPhoto(itemId: string, uploadedBy: string, fileName: string, bytes: Buffer, makePrimary = false) {
  requireDatabase();
  const id = randomUUID();
  const mimeType = evidenceMime(bytes);
  const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
  const existing = await prisma.itemPhoto.count({ where: { itemId } });
  const isPrimary = makePrimary || existing === 0;
  await prisma.$transaction(async (tx) => {
    if (isPrimary) await tx.itemPhoto.updateMany({ where: { itemId }, data: { isPrimary: false } });
    await tx.itemPhoto.create({
      data: { id, itemId, uploadedBy, fileName: safeName, mimeType, byteSize: bytes.length, isPrimary, contents: new Uint8Array(bytes) },
    });
  });
  return { id, itemId, fileName: safeName, mimeType, size: bytes.length, isPrimary };
}

export async function listItemPhotos(itemId: string) {
  requireDatabase();
  const rows = await prisma.itemPhoto.findMany({
    where: { itemId },
    select: { id: true, itemId: true, fileName: true, mimeType: true, byteSize: true, isPrimary: true, createdAt: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map(({ byteSize, ...row }) => ({ ...row, size: byteSize }));
}

export async function readItemPhoto(itemId: string, id: string) {
  requireDatabase();
  return prisma.itemPhoto.findFirst({ where: { itemId, id }, select: { mimeType: true, contents: true } });
}

export async function deleteItemPhoto(itemId: string, id: string) {
  requireDatabase();
  await prisma.$transaction(async (tx) => {
    await tx.itemPhoto.deleteMany({ where: { itemId, id } });
    const primary = await tx.itemPhoto.findFirst({ where: { itemId, isPrimary: true }, select: { id: true } });
    if (!primary) {
      const next = await tx.itemPhoto.findFirst({ where: { itemId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (next) await tx.itemPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  });
}
