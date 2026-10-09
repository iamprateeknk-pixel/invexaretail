// Database-first slice 3 (docs/db-first-reads-plan.md): open count assignments for a company, read from Postgres
// instead of the in-memory snapshot. Scoped through the assignment's location, which carries the real companyId.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import { countAssignments, type CountAssignmentRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

/** Assignments still waiting to be counted (status ASSIGNED) at locations the company owns, oldest first. */
export async function listOpenAssignmentsForCompany(ctx: TenantContext): Promise<CountAssignmentRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.countAssignment.findMany({
      where: { status: 'ASSIGNED', location: { companyId: ctx.companyId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
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
    }));
  }
  return countAssignments
    .filter((assignment) => assignment.status === 'ASSIGNED' && companyOwnsLocation(ctx.companyId, assignment.locationId))
    .map((assignment) => ({ ...assignment }));
}
