// ULTRA P1 (issue #184): the operational user list (GET /users) read from Postgres per company instead
// of the in-memory snapshot. The route used to list the snapshot and then look every user up in the
// enterprise repository just to learn their company; the database row carries companyId directly.
// Memory mode keeps the exact previous semantics: the snapshot list filtered by the enterprise
// repository's company for each user (default company when it has none recorded).
import { prisma } from '../db.js';
import { databaseEnabled, parseAssignedLocations } from '../persistence.js';
import { DEFAULT_COMPANY_ID } from '../saas/tenant-scope.js';
import * as enterpriseRepo from '../enterprise-repository.js';
import { users as memoryUsers, type UserRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

/** Every user of the company, oldest first (id as the tie-break). */
export async function listUsersForCompany(ctx: TenantContext): Promise<UserRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.user.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRecord['role'],
      assignedLocationIds: parseAssignedLocations(user.assignedLocations),
    }));
  }
  return memoryUsers.filter(
    (user) => (enterpriseRepo.findUserById(user.id)?.companyId ?? DEFAULT_COMPANY_ID) === ctx.companyId,
  );
}
