import type { Prisma } from '@prisma/client';

export function canManageStudioTasks(role: string): boolean {
  return role === 'ADMIN' || role === 'ADMIN_USER';
}

export function visibleStudioTaskFilter(role: string): Prisma.ExceptionCaseWhereInput {
  return canManageStudioTasks(role) ? {} : { NOT: { type: 'AUTOMATION_TASK' } };
}

export function canReadStudioTaskAudit(metadata: Record<string, unknown> | undefined, companyId: string, role: string): boolean {
  const taskCompanyId = metadata?.studioTaskCompanyId;
  return taskCompanyId === undefined || (taskCompanyId === companyId && canManageStudioTasks(role));
}
