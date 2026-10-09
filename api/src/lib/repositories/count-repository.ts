// Database-first slice 5 (docs/db-first-reads-plan.md): stock counts for a company, read from Postgres instead of the
// in-memory snapshot. Unlike the snapshot, which stamps every persisted count with role 'STORE_USER' (the role is not
// stored on StockCount), this reads the submitter's real role from User, falling back to STORE_USER only when the
// submitter is unknown. Nothing in web/ or mobile/ reads count.role; only GET /counts echoes it to blind-count workers.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import { counts as memoryCounts, type CountRecord } from '../repository.js';
import { countRowToRecord } from '../count-record-mapper.js';
import type { TenantContext } from '../tenant-context.js';

const ROLES: readonly CountRecord['role'][] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
const asRole = (value: string | undefined): CountRecord['role'] => (ROLES.includes(value as CountRecord['role']) ? (value as CountRecord['role']) : 'STORE_USER');

/** Every count at the company, oldest first (id as the tie-break). */
export async function listCountsForCompany(ctx: TenantContext): Promise<CountRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.stockCount.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const submitters = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.submittedById))] } }, select: { id: true, role: true } });
    const roleOf = new Map(submitters.map((user) => [user.id, user.role]));
    return rows.map((row) => countRowToRecord(row, asRole(roleOf.get(row.submittedById))));
  }
  return memoryCounts.filter((count) => companyOwnsLocation(ctx.companyId, count.locationId)).map((count) => ({ ...count }));
}
