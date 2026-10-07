// Release checklist (Web UX): "Dashboard KPI/chart totals reconcile to their source queues and every chart
// supports actionable drill-down." The number on a KPI card is only honest if the list behind it contains
// exactly that many rows. This seeds a mixed set of exception cases and checks, through the same
// repository functions the API uses, that:
//   - the headline `open` count equals the rows you reach by paging the open-exceptions list to the end;
//   - the per-status and per-priority breakdowns each add up to the headline;
//   - the `breached` count equals the overdue rows in that same list;
//   - a closed/resolved/rejected case appears in no total and no page;
//   - another company's data changes none of it.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import type { TenantContext } from './tenant-context.js';
import { getDashboardSummary, listOpenExceptions, type ExceptionListItem } from './reporting-repository.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function company(label: string) {
  const companyId = `dash-${label}-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `dash-user-${label}-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: label, email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const tenant: TenantContext = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
  return { tenant, userId };
}

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);

async function pageAll(tenant: TenantContext, pageSize: number): Promise<ExceptionListItem[]> {
  const rows: ExceptionListItem[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await listOpenExceptions(tenant, { cursor, limit: pageSize });
    rows.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return rows;
}

integration('every exception KPI equals the rows behind it, across pages, and ignores closed cases and other companies', async () => {
  const a = await company('a');
  const b = await company('b');
  const statuses = ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL'] as const;
  const priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
  let created = 0;
  for (let i = 0; i < 23; i += 1) {
    await prisma.exceptionCase.create({
      data: {
        type: 'DAMAGE', status: statuses[i % 3], priority: priorities[i % 4], title: `Open case ${i}`,
        reportedById: a.userId, companyId: a.tenant.companyId,
        dueAt: i % 5 === 0 ? null : i % 2 === 0 ? hoursFromNow(-(i + 1)) : hoursFromNow(i + 1), // some overdue, some upcoming, some with no due date
      },
    });
    created += 1;
  }
  for (const status of ['RESOLVED', 'CLOSED', 'REJECTED'] as const) {
    await prisma.exceptionCase.create({
      data: { type: 'DAMAGE', status, priority: 'CRITICAL', title: `Done ${status}`, reportedById: a.userId, companyId: a.tenant.companyId, dueAt: hoursFromNow(-100) },
    });
  }
  await prisma.exceptionCase.create({ data: { type: 'DAMAGE', status: 'OPEN', priority: 'CRITICAL', title: 'Company B case', reportedById: b.userId, companyId: b.tenant.companyId, dueAt: hoursFromNow(-1) } });

  const summary = (await getDashboardSummary(a.tenant)).exceptions;
  const rows = await pageAll(a.tenant, 5); // 5 per page forces several pages

  assert.equal(summary.open, created, 'the headline counts every open case and nothing else');
  assert.equal(rows.length, summary.open, 'the list behind the card has exactly that many rows');
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'no row appears on two pages');
  assert.ok(rows.every((row) => ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL'].includes(row.status)), 'closed, resolved and rejected cases are in no page');

  const openStatusTotal = statuses.reduce((sum, status) => sum + (summary.byStatus[status] ?? 0), 0);
  assert.equal(openStatusTotal, summary.open, 'the status breakdown adds up to the headline');
  for (const status of statuses) assert.equal(summary.byStatus[status] ?? 0, rows.filter((row) => row.status === status).length, `status ${status} matches its rows`);

  assert.equal(Object.values(summary.byPriority).reduce((sum, n) => sum + n, 0), summary.open, 'the priority breakdown adds up to the headline');
  for (const priority of priorities) assert.equal(summary.byPriority[priority] ?? 0, rows.filter((row) => row.priority === priority).length, `priority ${priority} matches its rows`);

  const overdueRows = rows.filter((row) => row.dueAt && row.dueAt.getTime() < Date.now()).length;
  assert.equal(summary.breached, overdueRows, 'the overdue KPI equals the overdue rows in the list');

  // Company B sees only its own single case; nothing of A's leaks into its totals or pages.
  const other = await getDashboardSummary(b.tenant);
  assert.equal(other.exceptions.open, 1);
  assert.equal((await pageAll(b.tenant, 5)).length, 1);
});
