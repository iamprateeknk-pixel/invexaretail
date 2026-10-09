// Database-first slice 8 (docs/db-first-reads-plan.md): GET /mobile/work, the one call the phone's Work tab needs.
// The response is built by one pure function (buildMobileWork) from already-loaded facts; only the loading differs
// by mode. In database mode the loader asks Postgres for just what this user needs (their open assignments, those
// items with their lots, the ledger rows for those item/location pairs, and receivable transfers) instead of
// scanning the in-memory snapshot, and never loads the whole catalogue.
import type { TransferStatus } from '@prisma/client';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import { isCountWorkerRole } from './count-lifecycle.js';
import { canAccessLocation, type AccessContext } from './inventory.js';
import { isOperationalItem } from './item-master.js';
import { itemRowToRecord } from './item-record-mapper.js';
import { listMyOpenAssignments } from './repositories/count-assignment-repository.js';
import {
  findStockLedgerEntry, items as memoryItems, listCountAssignmentsFor, listTransfers,
  type CountAssignmentRecord, type ItemRecord,
} from './repository.js';
import type { TenantContext } from './tenant-context.js';

// The database enum only has PARTIAL_RECEIVED; the in-memory record type also allows the legacy PARTIALLY_RECEIVED.
const RECEIVABLE_STATUSES: string[] = ['DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'PARTIAL_RECEIVED'];
const RECEIVABLE_DB_STATUSES: TransferStatus[] = ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'];
const RECEIVER_ROLES = ['STORE_USER', 'BRANCH_MANAGER', 'ADMIN', 'ADMIN_USER'];

type ReceivableTransfer = {
  id: string; sourceLocationId: string; destinationLocationId: string; status: string;
  lineCount: number; cartonCount?: number; createdAt: string;
};

export type MobileWorkFacts = {
  assignments: CountAssignmentRecord[];
  itemsById: Map<string, ItemRecord>;
  /** On-hand quantity by `${itemId}|${lotId}|${locationId}`. */
  onHand: (itemId: string, lotId: string, locationId: string) => number;
  transfers: ReceivableTransfer[];
};

/** Pure: turns loaded facts into the response, applying the same rules the handler always had. */
export function buildMobileWork(context: AccessContext, facts: MobileWorkFacts) {
  const countTasks = facts.assignments.flatMap((assignment) => {
    const item = facts.itemsById.get(assignment.itemId);
    if (!item || !isOperationalItem(item) || !canAccessLocation(context, assignment.locationId)) return [];
    const lots = item.lots
      .filter((lot) => (lot.status ?? 'AVAILABLE') === 'AVAILABLE' && facts.onHand(item.id, lot.id, assignment.locationId) > 0)
      .map((lot) => ({ lotId: lot.id, lotNo: lot.lotNo, expiryDate: lot.expiryDate ?? null }));
    // Nothing on the shelf to count: not an actionable task for a store user.
    if (!lots.length) return [];
    return [{
      assignmentId: assignment.id,
      locationId: assignment.locationId,
      countDate: assignment.countDate,
      dueDate: assignment.dueDate,
      priority: assignment.priority ?? 'NORMAL',
      instructions: assignment.instructions,
      campaignId: assignment.campaignId,
      recount: Boolean(assignment.parentCountId),
      item: {
        id: item.id, code: item.code, name: item.name, barcode: item.barcode, unit: item.unit,
        countMethod: item.countMethod ?? 'LOT_SCAN', decimalQuantity: Boolean(item.decimalQuantity) || item.countMethod === 'ITEM_WEIGHT',
      },
      lots,
    }];
  });
  const receiveTasks = facts.transfers
    .filter((transfer) => canAccessLocation(context, transfer.destinationLocationId))
    .map((transfer) => ({
      transferId: transfer.id,
      sourceLocationId: transfer.sourceLocationId,
      destinationLocationId: transfer.destinationLocationId,
      status: transfer.status,
      lineCount: transfer.lineCount,
      cartonCount: transfer.cartonCount,
      createdAt: transfer.createdAt,
    }));
  return { countTasks, receiveTasks };
}

async function loadFromDatabase(ctx: TenantContext, context: AccessContext, isCounter: boolean, canReceive: boolean): Promise<MobileWorkFacts> {
  const assignments = isCounter ? await listMyOpenAssignments(ctx) : [];
  const itemIds = [...new Set(assignments.map((assignment) => assignment.itemId))];
  const locationIds = [...new Set(assignments.map((assignment) => assignment.locationId))];

  const [itemRows, ledgerRows, transferRows] = await Promise.all([
    itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds }, companyId: ctx.companyId }, include: { lots: true } }) : [],
    itemIds.length
      ? prisma.stockLedger.findMany({ where: { itemId: { in: itemIds }, locationId: { in: locationIds }, onHand: { gt: 0 } }, select: { itemId: true, lotId: true, locationId: true, onHand: true } })
      : [],
    canReceive
      ? prisma.transfer.findMany({
        where: { companyId: ctx.companyId, status: { in: RECEIVABLE_DB_STATUSES } },
        select: { id: true, sourceLocationId: true, destinationLocationId: true, status: true, cartonCount: true, createdAt: true, _count: { select: { lines: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      : [],
  ]);

  const stock = new Map<string, number>(ledgerRows.map((row) => [`${row.itemId}|${row.lotId}|${row.locationId}`, row.onHand] as const));
  return {
    assignments,
    itemsById: new Map<string, ItemRecord>(itemRows.map((row) => [row.id, itemRowToRecord(row)] as const)),
    onHand: (itemId, lotId, locationId) => stock.get(`${itemId}|${lotId}|${locationId}`) ?? 0,
    transfers: transferRows.map((row) => ({
      id: row.id,
      sourceLocationId: row.sourceLocationId,
      destinationLocationId: row.destinationLocationId,
      status: row.status,
      lineCount: row._count.lines,
      cartonCount: row.cartonCount ?? undefined,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function loadFromSnapshot(userId: string, isCounter: boolean, canReceive: boolean): MobileWorkFacts {
  return {
    assignments: isCounter ? listCountAssignmentsFor(userId) : [],
    itemsById: new Map(memoryItems.map((item) => [item.id, item])),
    onHand: (itemId, lotId, locationId) => findStockLedgerEntry(itemId, lotId, locationId)?.onHand ?? 0,
    transfers: canReceive
      ? listTransfers()
        .filter((transfer) => RECEIVABLE_STATUSES.includes(transfer.status))
        .map((transfer) => ({
          id: transfer.id,
          sourceLocationId: transfer.sourceLocationId,
          destinationLocationId: transfer.destinationLocationId,
          status: transfer.status,
          lineCount: transfer.lines.length,
          cartonCount: transfer.cartonCount,
          createdAt: transfer.createdAt,
        }))
      : [],
  };
}

export async function loadMobileWork(ctx: TenantContext, context: AccessContext) {
  // Every count-worker role (store users, warehouse pickers, branch managers) gets its own tasks -
  // the same rule /count-assignments/mine and /stock-counts use.
  const isCounter = isCountWorkerRole(context.role);
  const canReceive = RECEIVER_ROLES.includes(context.role);
  const facts = databaseEnabled
    ? await loadFromDatabase(ctx, context, isCounter, canReceive)
    : loadFromSnapshot(ctx.userId, isCounter, canReceive);
  return buildMobileWork(context, facts);
}

/** The snapshot path on its own, for parity tests that run with the database enabled. */
export function loadMobileWorkFromSnapshot(ctx: TenantContext, context: AccessContext) {
  const isCounter = isCountWorkerRole(context.role);
  return buildMobileWork(context, loadFromSnapshot(ctx.userId, isCounter, RECEIVER_ROLES.includes(context.role)));
}
