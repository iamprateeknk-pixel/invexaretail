// Database-first slice 3 (docs/db-first-reads-plan.md): open count assignments for a company, read from Postgres
// instead of the in-memory snapshot. Scoped through the assignment's location, which carries the real companyId.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import { countAssignments, items as memoryItems, listCountAssignmentsFor, type CountAssignmentRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

function assignmentRowToRecord(row: {
  id: string; locationId: string; itemId: string; assignedToId: string; assignedById: string; countDate: Date; dueDate: Date | null;
  priority: string; instructions: string | null; status: CountAssignmentRecord['status']; countId: string | null; parentCountId: string | null;
  campaignId: string | null; createdAt: Date;
}): CountAssignmentRecord {
  return {
    id: row.id,
    locationId: row.locationId,
    itemId: row.itemId,
    assignedToId: row.assignedToId,
    assignedById: row.assignedById,
    countDate: row.countDate.toISOString(),
    dueDate: row.dueDate?.toISOString(),
    priority: (row.priority as CountAssignmentRecord['priority']) || 'NORMAL',
    instructions: row.instructions ?? undefined,
    status: row.status,
    countId: row.countId ?? undefined,
    parentCountId: row.parentCountId ?? undefined,
    campaignId: row.campaignId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Assignments still waiting to be counted (status ASSIGNED) at locations the company owns, oldest first. */
export async function listOpenAssignmentsForCompany(ctx: TenantContext): Promise<CountAssignmentRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.countAssignment.findMany({
      where: { status: 'ASSIGNED', location: { companyId: ctx.companyId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(assignmentRowToRecord);
  }
  return countAssignments
    .filter((assignment) => assignment.status === 'ASSIGNED' && companyOwnsLocation(ctx.companyId, assignment.locationId))
    .map((assignment) => ({ ...assignment }));
}

/** Every assignment (any status) at locations the company owns, oldest first — ULTRA P1, for the command center. */
export async function listAssignmentsForCompany(ctx: TenantContext): Promise<CountAssignmentRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.countAssignment.findMany({
      where: { location: { companyId: ctx.companyId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(assignmentRowToRecord);
  }
  return countAssignments
    .filter((assignment) => companyOwnsLocation(ctx.companyId, assignment.locationId))
    .map((assignment) => ({ ...assignment }));
}

/**
 * The signed-in count worker's own open tasks (GET /count-assignments/mine), each with its item's name and code.
 * Database mode also requires the assignment's location to belong to the company.
 */
export async function listMyOpenAssignments(ctx: TenantContext): Promise<Array<CountAssignmentRecord & { itemName: string; itemCode?: string }>> {
  if (databaseEnabled) {
    const rows = await prisma.countAssignment.findMany({
      where: { assignedToId: ctx.userId, status: 'ASSIGNED', location: { companyId: ctx.companyId } },
      include: { item: { select: { name: true, code: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ ...assignmentRowToRecord(row), itemName: row.item?.name ?? row.itemId, itemCode: row.item?.code }));
  }
  return listCountAssignmentsFor(ctx.userId).map((assignment) => {
    const item = memoryItems.find((candidate) => candidate.id === assignment.itemId);
    return { ...assignment, itemName: item?.name ?? assignment.itemId, itemCode: item?.code };
  });
}
