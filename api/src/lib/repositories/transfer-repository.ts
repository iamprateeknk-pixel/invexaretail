// Week 8: the first Transfer repository, extracted alongside routes/transfers.ts
// as the "starting with Inventory and Transfers" slice of the god-router
// split. Every exported function requires an `AccessContext` as its first
// argument - mirroring ADR-002's "the type signature must require it"
// discipline for `lib/repositories/item-repository.ts` - even though the
// underlying enforcement here is location-based (`canAccessLocation`), not
// a `companyId` column filter.
//
// ULTRA P1 (issue #184): the read side is now database-first, closing the gap
// the Week 8 note above left open. `listTransfersForCompany`,
// `findTransferForCompany` and `listTransferCartonsForTransfers` take a
// TenantContext and query Postgres scoped by the Transfer row's own companyId
// (backfilled from its source location) OR by destination-location ownership —
// the snapshot's list semantics were "source or destination belongs to the
// company", and Transfer has no destinationLocation relation, so destination
// ownership is resolved through the company's location ids. Rows go through
// lib/transfer-record-mapper.ts, the same mapping snapshot hydration uses.
// In memory mode every function delegates to the snapshot accessors it
// replaces, byte-for-byte. The synchronous `listTransfersForContext` remains
// for the snapshot-internal callers (picker queues are already database-first
// via lib/picker-tasks.ts) and as the memory branch of the async list.
import type { AccessContext } from '../inventory.js';
import { canAccessLocation } from '../inventory.js';
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import { findTransferForCompany as findSnapshotTransferForCompany, listTransfers as listAllTransfers, createTransferRecord, type TransferRecord } from '../repository.js';
import { activeCartons, isTransitDelayed, type TransferCartonRecord } from '../transfer-packing.js';
import { listTransferCartons } from '../repository.js';
import { transferRowToRecord, transferCartonRowToRecord } from '../transfer-record-mapper.js';
import type { TenantContext } from '../tenant-context.js';

export type TransferListItem = TransferRecord & {
  cartons: Array<{ packageId: string; quantity: number; weightKg?: number }>;
  delayed: boolean;
};

function toListItem(transfer: TransferRecord, cartons: TransferCartonRecord[]): TransferListItem {
  return {
    ...transfer,
    cartons: activeCartons(cartons).map((carton) => ({
      packageId: carton.packageId,
      quantity: carton.quantity,
      weightKg: carton.weightKg,
    })),
    delayed: isTransitDelayed({ status: transfer.status, expectedArrivalAt: transfer.dispatch?.expectedArrivalAt }),
  };
}

/** Every transfer whose source or destination the caller's access context can see. */
export function listTransfersForContext(ctx: AccessContext): TransferListItem[] {
  return listAllTransfers()
    .filter((transfer) => canAccessLocation(ctx, transfer.sourceLocationId) || canAccessLocation(ctx, transfer.destinationLocationId))
    .map((transfer) => toListItem(transfer, listTransferCartons(transfer.id)));
}

async function companyLocationIds(companyId: string): Promise<string[]> {
  const rows = await prisma.location.findMany({ where: { companyId }, select: { id: true } });
  return rows.map((row) => row.id);
}

/** The tenant scope for transfers: the row's company, or a destination at one of the company's locations. */
async function companyTransferScope(ctx: TenantContext) {
  const locationIds = await companyLocationIds(ctx.companyId);
  return [{ companyId: ctx.companyId }, { destinationLocationId: { in: locationIds } }];
}

/** Every transfer of the company (as source or destination), oldest first — Postgres in database mode. */
export async function listTransfersForCompany(ctx: TenantContext): Promise<TransferRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.transfer.findMany({
      where: { OR: await companyTransferScope(ctx) },
      include: { lines: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(transferRowToRecord);
  }
  return listAllTransfers().filter(
    (transfer) => companyOwnsLocation(ctx.companyId, transfer.sourceLocationId) || companyOwnsLocation(ctx.companyId, transfer.destinationLocationId),
  );
}

/** One transfer of the company by id, or null — the same answer for another company's transfer as for a missing one. */
export async function findTransferForCompany(ctx: TenantContext, transferId: string): Promise<TransferRecord | null> {
  if (databaseEnabled) {
    const row = await prisma.transfer.findFirst({
      where: { id: transferId, OR: await companyTransferScope(ctx) },
      include: { lines: true },
    });
    return row ? transferRowToRecord(row) : null;
  }
  return findSnapshotTransferForCompany(transferId, ctx.companyId) ?? null;
}

/** Cartons of the given transfers, oldest first, scoped through their transfers' company. */
export async function listTransferCartonsForTransfers(ctx: TenantContext, transferIds: string[]): Promise<TransferCartonRecord[]> {
  if (!transferIds.length) return [];
  if (databaseEnabled) {
    const owned = await prisma.transfer.findMany({
      where: { id: { in: transferIds }, OR: await companyTransferScope(ctx) },
      select: { id: true },
    });
    const ownedIds = owned.map((row) => row.id);
    if (!ownedIds.length) return [];
    const rows = await prisma.transferCarton.findMany({
      where: { transferId: { in: ownedIds } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(transferCartonRowToRecord);
  }
  return listTransferCartons().filter((carton) => transferIds.includes(carton.transferId));
}

/** Database-first version of listTransfersForContext (GET /transfers/list): same filtering, enrichment and shape. */
export async function listTransfersForContextDb(ctx: AccessContext, tenant: TenantContext): Promise<TransferListItem[]> {
  if (!databaseEnabled) return listTransfersForContext(ctx);
  const visible = (await listTransfersForCompany(tenant)).filter(
    (transfer) => canAccessLocation(ctx, transfer.sourceLocationId) || canAccessLocation(ctx, transfer.destinationLocationId),
  );
  const cartons = await listTransferCartonsForTransfers(tenant, visible.map((transfer) => transfer.id));
  return visible.map((transfer) => toListItem(transfer, cartons.filter((carton) => carton.transferId === transfer.id)));
}

export { createTransferRecord };
