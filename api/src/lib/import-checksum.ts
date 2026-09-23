// Week 11: file/content checksum for import idempotency. A duplicate
// upload of the same file (same bytes) must never create a second batch
// and re-post the same movements - this is the guard for that, checked
// before an ImportBatch row is even created.
import { createHash } from 'node:crypto';
import { prisma } from './db.js';

export function computeFileChecksum(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * A duplicate is the same checksum, same type, same tenant. Different
 * tenants uploading byte-identical files (e.g. a shared vendor template)
 * are not duplicates of each other - each company's import history is its
 * own.
 */
export async function findDuplicateBatch(companyId: string, type: string, fileChecksum: string) {
  return prisma.importBatch.findFirst({
    where: { companyId, type, fileHash: fileChecksum, status: { not: 'FAILED' } },
    orderBy: { importedAt: 'desc' },
  });
}
