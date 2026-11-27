import { databaseEnabled } from './persistence.js';
import { loadTransferPickSlips } from './persistence.js';
import { listAuditEvents, rememberPersistedAudit } from './audit.js';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { transitionTransferStatus } from './domain-policies.js';
import { DomainError } from './errors.js';
import { pickRevision, transferPickChanged } from './pick-revision.js';
import type { TransferRecord } from './repository.js';
import { listItemsForCompany } from './repositories/item-repository.js';
import { listStockForLocation } from './repositories/stock-repository.js';
import type { TenantContext } from './tenant-context.js';
import { transferRowToRecord } from './transfer-record-mapper.js';
import { pickSlipSchema } from './validation-schemas.js';

// The pick slips saved against a transfer: from the audit journal in memory mode, from the database otherwise.
export async function savedPickSlips(transferId: string) {
  if (databaseEnabled) return loadTransferPickSlips(transferId);
  return listAuditEvents().filter((event) => event.entityType === 'Transfer' && event.entityId === transferId && event.action === 'PICK_SLIP_SAVED');
}

type PickSlip = { id: string; requestId?: string; pickerId: string; requestFingerprint?: string } & Record<string, unknown>;

/** Bind the operator's original input before server lot allocation and timestamps. */
export function pickSlipRequestFingerprint(input: Record<string, unknown>): string | undefined {
  const parsed = pickSlipSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const { pickRevision, lines = [], exceptions = [] } = parsed.data;
  const startedAt = typeof input.startedAt === 'string' ? input.startedAt : null;
  return createHash('sha256')
    .update(JSON.stringify([pickRevision ?? null, lines, exceptions, Boolean(input.finished), startedAt]))
    .digest('hex');
}

export function matchesPickSlipRequest(savedFingerprint: unknown, submittedFingerprint: string | undefined): boolean {
  // Slips created before fingerprinting remain recoverable by their original request ID.
  return typeof savedFingerprint !== 'string' || savedFingerprint === submittedFingerprint;
}

export const pickSlipRequestReused = () =>
  new DomainError('DUPLICATE_REQUEST', 'This request ID already belongs to a different pick submission.');

/** Keep the status update and durable replay receipt in the same transaction. */
export async function savePickSlip(ctx: TenantContext, transferId: string, expectedRevision: string,
  status: TransferRecord['status'], metadata: PickSlip) {
  const event = {
    id: randomUUID(), actorId: ctx.userId, actorRole: ctx.role, action: 'PICK_SLIP_SAVED',
    entityType: 'Transfer', entityId: transferId, metadata, createdAt: new Date().toISOString(),
  };
  // A serialization failure can be an identical request winning the race. Read again so
  // the winner's original slip is returned, or the obsolete revision is rejected.
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Transfer" WHERE id = ${transferId} AND "companyId" = ${ctx.companyId} FOR UPDATE`;
        const row = await tx.transfer.findFirst({ where: { id: transferId, companyId: ctx.companyId }, include: { lines: true } });
        if (!row) throw transferPickChanged();
        const transfer = transferRowToRecord(row);
        const slips = await tx.auditLog.findMany({ where: { entityType: 'Transfer', entityId: transferId, action: 'PICK_SLIP_SAVED' } });
        const duplicate = metadata.requestId && slips.find((slip) => {
          const data = slip.metadata as PickSlip | null;
          return data?.requestId === metadata.requestId && slip.actorId === ctx.userId;
        });
        if (duplicate) {
          const saved = duplicate.metadata as PickSlip;
          if (!matchesPickSlipRequest(saved.requestFingerprint, metadata.requestFingerprint)) throw pickSlipRequestReused();
          return { transfer, metadata: saved, duplicate: true };
        }
        const [items, ledger] = await Promise.all([
          listItemsForCompany(ctx, tx), listStockForLocation(ctx, transfer.sourceLocationId, tx),
        ]);
        if (expectedRevision !== pickRevision(transfer, new Map(items.map((item) => [item.id, item])), ledger, slips.map((slip) => slip.id))) {
          throw transferPickChanged();
        }
        if (transfer.status !== status) {
          if (transfer.status === 'REQUESTED' && status !== 'PICKING') {
            await transitionTransferStatus({ entityId: transferId, companyId: ctx.companyId, to: 'PICKING', role: ctx.role, actorId: ctx.userId }, tx);
          }
          await transitionTransferStatus({ entityId: transferId, companyId: ctx.companyId, to: status, role: ctx.role, actorId: ctx.userId }, tx);
        }
        await tx.auditLog.create({ data: { ...event, metadata: metadata as Prisma.InputJsonValue } });
        return { transfer: { ...transfer, status }, metadata, duplicate: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!result.duplicate) rememberPersistedAudit(event);
      return result;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      // Prisma's PostgreSQL adapter puts the SQLSTATE in the underlying driver error for raw queries.
      const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
      const serializationFailure = error.code === 'P2034' || (error.code === 'P2010'
        && (error.meta?.code === '40001' || adapter?.cause?.originalCode === '40001'));
      if (!serializationFailure) throw error;
      if (attempt >= 2) throw new DomainError('CONFLICT', 'The pick could not be saved during another update. Try again.');
    }
  }
}
