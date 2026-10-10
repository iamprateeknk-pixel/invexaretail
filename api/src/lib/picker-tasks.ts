// Database-first slice 9 (docs/db-first-reads-plan.md): GET /picker-tasks. The response is built by one pure function
// from the transfers the picker could work on; only the loading differs by mode (Postgres in database mode).
import type { TransferStatus } from '@prisma/client';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import { canAccessLocation, type AccessContext } from './inventory.js';
import { pickerMayWork } from './transfer-assignment.js';
import { companyOwnsLocation } from './saas/tenant-scope.js';
import { listTransfers, type TransferRecord } from './repository.js';
import type { TenantContext } from './tenant-context.js';

// The database enum has no SUBMITTED/DRAFT here; these are the pickable statuses in both representations.
const PICKABLE_STATUSES = ['REQUESTED', 'PENDING_PICK', 'PICKING', 'PARTIAL'];
const PICKABLE_DB_STATUSES: TransferStatus[] = ['REQUESTED', 'PENDING_PICK', 'PICKING', 'PARTIAL'];

export type PickableTransfer = Pick<TransferRecord, 'id' | 'sourceLocationId' | 'lines' | 'assignedPickerId'>;

/** Transfers still waiting to be picked in the company, oldest first. */
export async function listPickableTransfers(ctx: TenantContext): Promise<PickableTransfer[]> {
  if (databaseEnabled) {
    const rows = await prisma.transfer.findMany({
      where: { companyId: ctx.companyId, status: { in: PICKABLE_DB_STATUSES } },
      select: {
        id: true, sourceLocationId: true, assignedPickerId: true,
        lines: { select: { itemId: true, lotId: true, requestedQty: true, receivedQty: true, damagedQty: true, shortageQty: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      sourceLocationId: row.sourceLocationId,
      // Same line shape snapshot hydration builds.
      lines: row.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, quantity: line.requestedQty, receivedQty: line.receivedQty, damagedQty: line.damagedQty, shortageQty: line.shortageQty ?? 0 })),
      ...(row.assignedPickerId ? { assignedPickerId: row.assignedPickerId } : {}),
    }));
  }
  return listTransfers()
    .filter((transfer) => PICKABLE_STATUSES.includes(transfer.status) && companyOwnsLocation(ctx.companyId, transfer.sourceLocationId))
    .map((transfer) => ({ id: transfer.id, sourceLocationId: transfer.sourceLocationId, lines: transfer.lines, assignedPickerId: transfer.assignedPickerId }));
}

/** Pure: the picker's task list from the loaded transfers (access and assignment rules unchanged). */
export function buildPickerTasks(context: AccessContext, userId: string, transfers: PickableTransfer[]) {
  return transfers
    .filter((transfer) => canAccessLocation(context, transfer.sourceLocationId))
    // A transfer an admin handed to one picker leaves every other picker's queue.
    .filter((transfer) => context.role !== 'WAREHOUSE_PICKER' || pickerMayWork(transfer, userId))
    .map((transfer) => ({
      transferId: transfer.id,
      locationId: transfer.sourceLocationId,
      lines: transfer.lines,
      status: 'ASSIGNED',
      assignedPickerId: transfer.assignedPickerId ?? null,
      assignedToMe: transfer.assignedPickerId === userId,
    }));
}
