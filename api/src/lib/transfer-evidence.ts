import { randomUUID } from 'node:crypto';
import { prisma, resolveDatabaseUrl } from './db.js';

export function evidenceMime(bytes: Buffer): string {
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new Error('Photo must be between 1 byte and 5 MB.');
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  throw new Error('Only JPEG, PNG and WebP photos are supported.');
}

function requireDatabase(): void {
  if (!resolveDatabaseUrl()) throw new Error('Durable evidence requires a connected PostgreSQL database.');
}

export async function saveTransferEvidence(transferId: string, uploadedBy: string, fileName: string, bytes: Buffer) {
  requireDatabase();
  const id = randomUUID();
  const mimeType = evidenceMime(bytes);
  const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
  await prisma.transferEvidence.create({
    data: { id, transferId, uploadedBy, fileName: safeName, mimeType, byteSize: bytes.length, contents: new Uint8Array(bytes) },
  });
  return { id, transferId, fileName: safeName, mimeType, size: bytes.length };
}

export async function listTransferEvidence(transferId: string) {
  requireDatabase();
  const rows = await prisma.transferEvidence.findMany({
    where: { transferId },
    select: { id: true, transferId: true, fileName: true, mimeType: true, byteSize: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(({ byteSize, ...row }) => ({ ...row, size: byteSize }));
}

export async function readTransferEvidence(transferId: string, id: string) {
  requireDatabase();
  return prisma.transferEvidence.findFirst({ where: { transferId, id }, select: { mimeType: true, contents: true } });
}
