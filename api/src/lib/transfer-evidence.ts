import { prisma, resolveDatabaseUrl } from './db.js';

export function evidenceMime(bytes: Buffer): string {
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new Error('Photo must be between 1 byte and 5 MB.');
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  throw new Error('Only JPEG, PNG and WebP photos are supported.');
}

export async function saveTransferEvidence(transferId: string, uploadedBy: string, fileName: string, bytes: Buffer) {
  if (!resolveDatabaseUrl()) throw new Error('Durable evidence requires a connected database.');
  const mimeType = evidenceMime(bytes);
  const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
  const row = await prisma.transferEvidence.create({
    data: { transferId, uploadedBy, fileName: safeName, mimeType, byteSize: bytes.length, contents: Uint8Array.from(bytes) },
  });
  return { id: row.id, transferId, fileName: safeName, mimeType, size: bytes.length };
}

export async function listTransferEvidence(transferId: string) {
  const rows = await prisma.transferEvidence.findMany({
    where: { transferId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, transferId: true, fileName: true, mimeType: true, byteSize: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, size: row.byteSize }));
}

export async function readTransferEvidence(transferId: string, id: string) {
  const row = await prisma.transferEvidence.findFirst({ where: { transferId, id }, select: { mimeType: true, contents: true } });
  return row ? { mimeType: row.mimeType, contents: row.contents } : undefined;
}
