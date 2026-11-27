import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { countRowToRecord } from './count-record-mapper.js';
import { prisma } from './db.js';
import { DomainError } from './errors.js';
import type { CountRecord } from './repository.js';
import type { TenantContext } from './tenant-context.js';

export type CountSubmissionIntent = {
  requestId: string;
  kind: 'LOT' | 'POOLED';
  itemId: string;
  locationId: string;
  lotNo?: string;
  mode: CountRecord['mode'];
  quantity: number;
  stockRevision?: string;
};

export type CountSubmissionGuard = { fingerprint: string; stockRevision?: string };

export function countSubmissionFingerprint(intent: CountSubmissionIntent): string {
  const fields = [intent.kind, intent.itemId, intent.locationId, intent.lotNo?.toLowerCase() ?? null, intent.mode, intent.quantity];
  if (intent.stockRevision) fields.push(intent.stockRevision);
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export class CountSubmissionAlreadyRecorded extends Error {}

export async function reserveCountSubmission(
  tx: Prisma.TransactionClient,
  companyId: string,
  counts: readonly CountRecord[],
  fingerprint: string,
): Promise<void> {
  const first = counts[0];
  if (!first?.requestId) throw new Error('Count submission receipt requires a request ID.');
  const result = await tx.countSubmissionReceipt.createMany({
    data: {
      companyId, actorId: first.submittedBy, requestId: first.requestId, fingerprint, countIds: counts.map(({ id }) => id),
    },
    skipDuplicates: true,
  });
  if (result.count === 0) throw new CountSubmissionAlreadyRecorded();
}

export async function findCountSubmission(ctx: TenantContext, intent: CountSubmissionIntent): Promise<CountRecord[]> {
  const scope = { companyId: ctx.companyId, actorId: ctx.userId, requestId: intent.requestId };
  const { receipt, rows } = await prisma.$transaction(async (tx) => {
    const receipt = await tx.countSubmissionReceipt.findUnique({ where: { companyId_actorId_requestId: scope } });
    const rows = await tx.stockCount.findMany({
      where: { companyId: ctx.companyId, submittedById: ctx.userId, requestId: intent.requestId },
      include: { lot: { select: { lotNo: true } } },
      orderBy: [{ countDate: 'asc' }, { id: 'asc' }],
    });
    return { receipt, rows };
  }, { isolationLevel: 'RepeatableRead' });
  const reused = () => new DomainError('CONFLICT', 'This count request ID was already used for a different submission.');
  if (receipt && receipt.fingerprint !== countSubmissionFingerprint(intent)) throw reused();

  if (receipt) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return receipt.countIds.map((id) => {
      const row = byId.get(id);
      if (!row) throw new DomainError('INTERNAL_ERROR', 'The count submission receipt is incomplete.');
      return countRowToRecord({ ...row, bookQty: row.bookQtyOriginal ?? row.bookQty }, ctx.role);
    });
  }
  if (!rows.length) return [];

  // Older releases stored the request ID only on the count rows. Preserve
  // retries of these records and reject any observable difference in intent.
  const milliUnits = (value: number) => Math.round(value * 1000);
  const quantity = rows.reduce((total, row) => total + milliUnits(Number(row.physicalQty)), 0);
  if ((intent.kind === 'LOT' && rows.length !== 1) || quantity !== milliUnits(intent.quantity) ||
    rows.some((row) => row.itemId !== intent.itemId || row.locationId !== intent.locationId || row.mode !== intent.mode ||
      (intent.lotNo && row.lot.lotNo.toLowerCase() !== intent.lotNo.toLowerCase()))) {
    throw reused();
  }
  return rows.map((row) => countRowToRecord(row, ctx.role));
}
