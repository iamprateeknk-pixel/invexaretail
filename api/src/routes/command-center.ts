import { Router, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { databaseProbe, prisma } from '../lib/db.js';
import { listAuditEvents } from '../lib/audit.js';
import { latestEventId, subscriberCount } from '../lib/event-bus.js';
import { listUsersByCompany } from '../lib/enterprise-repository.js';
import { companyOwnsLocation, DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { listCountAssignments, listCounts, listItems, listLocations, listSyncCheckpoints, listTransfers } from '../lib/repository.js';
import { databaseEnabled } from '../lib/persistence.js';
import { buildCommandCenter } from '../lib/command-center.js';
import { metricsSnapshot } from '../lib/request-metrics.js';
import { outboxHealthSnapshot } from '../lib/event-bus.js';
import { stuckTransfers } from '../lib/command-center.js';
import { auditCsv, countAccuracyReport, filterAudit, transferCycleReport, type AccuracyGroup } from '../lib/report-builders.js';

// Blueprint v4 §29 Command Center and §30 Reports. Read-only.
const router = Router();
const guard = [extractToken, requireAuth];

const MANAGEMENT = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'];

function scope(req: Request) {
  const user = req.user!;
  const companyId = req.companyId ?? user.companyId ?? DEFAULT_COMPANY_ID;
  const all = user.role === 'ADMIN' || user.role === 'ADMIN_USER' || user.role === 'AUDITOR' && !(user.locationIds ?? []).length;
  const allowed = (locationId: string) => companyOwnsLocation(companyId, locationId) && (all || (user.locationIds ?? []).includes(locationId));
  return { companyId, allowed };
}

// The audit list carries no company id, so a company sees the actions of its own users
// (plus system/connector actions, which belong to no user) and never another company's.
function companyAudit(companyId: string) {
  const own = new Set(listUsersByCompany(companyId).map((user) => user.id));
  return listAuditEvents().filter((event) => own.has(event.actorId) || ['system', 'connector', 'SYSTEM'].includes(event.actorId));
}

function deny(res: Response) {
  return res.status(403).json({ message: 'The command center is for admins, branch managers and auditors.' });
}

// The parts only the database holds; a failure here never takes the dashboard down.
async function databaseExtras() {
  if (!databaseEnabled) return undefined;
  try {
    const open = ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL'] as never[];
    const [openCount, critical, overdue, pending] = await Promise.all([
      prisma.exceptionCase.count({ where: { status: { in: open } } }),
      prisma.exceptionCase.count({ where: { status: { in: open }, priority: 'CRITICAL' } }),
      prisma.exceptionCase.count({ where: { status: { in: open }, dueAt: { lt: new Date() } } }),
      prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    ]);
    return { exceptions: { open: openCount, critical, overdue }, approvals: { pending } };
  } catch (error) {
    console.warn('[command-center] database extras unavailable:', error instanceof Error ? error.message : error);
    return undefined;
  }
}

router.get('/command-center', ...guard, async (req: Request, res: Response) => {
  if (!MANAGEMENT.includes(req.user!.role)) return deny(res);
  const { companyId, allowed } = scope(req);
  const locations = listLocations().filter((location) => allowed(location.id));
  const locationIds = new Set(locations.map((location) => location.id));
  const users = new Map(listUsersByCompany(companyId).map((user) => [user.id, user.name]));
  const center = buildCommandCenter({
    now: new Date(),
    locations,
    counts: listCounts().filter((count) => locationIds.has(count.locationId)),
    assignments: listCountAssignments().filter((row) => locationIds.has(row.locationId)),
    transfers: listTransfers().filter((transfer) => locationIds.has(transfer.sourceLocationId) || locationIds.has(transfer.destinationLocationId)),
    checkpoints: listSyncCheckpoints().filter((row) => locationIds.has(row.locationId)),
    audit: companyAudit(companyId),
    userNames: users,
    live: { clients: subscriberCount(), lastEventId: latestEventId() },
    extras: await databaseExtras(),
  });
  return res.json({ commandCenter: center });
});

router.get('/reports/transfer-cycle', ...guard, (req: Request, res: Response) => {
  if (!MANAGEMENT.includes(req.user!.role)) return res.status(403).json({ message: 'Reports require Admin, Branch Manager or Auditor access.' });
  const { companyId, allowed } = scope(req);
  const transfers = listTransfers().filter((transfer) => allowed(transfer.sourceLocationId) || allowed(transfer.destinationLocationId));
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  return res.json({ report: transferCycleReport(transfers, companyAudit(companyId), { from, to }) });
});

router.get('/reports/count-accuracy', ...guard, (req: Request, res: Response) => {
  if (!MANAGEMENT.includes(req.user!.role)) return res.status(403).json({ message: 'Reports require Admin, Branch Manager or Auditor access.' });
  const groupBy = (['branch', 'user', 'category'].includes(String(req.query.groupBy)) ? String(req.query.groupBy) : 'branch') as AccuracyGroup;
  const { companyId, allowed } = scope(req);
  return res.json({
    groupBy,
    rows: countAccuracyReport({
      counts: listCounts().filter((count) => allowed(count.locationId)),
      items: listItems(),
      groupBy,
      labels: { locations: new Map(listLocations().map((location) => [location.id, location.name])), users: new Map(listUsersByCompany(companyId).map((user) => [user.id, user.name])) },
      range: { from: typeof req.query.from === 'string' ? req.query.from : undefined, to: typeof req.query.to === 'string' ? req.query.to : undefined },
    }),
  });
});

// Blueprint §30: "Full audit export by actor/action/entity/date."
router.get('/reports/audit-export', ...guard, (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'The audit export requires Admin or Auditor access.' });
  const { companyId } = scope(req);
  const text = (key: string) => (typeof req.query[key] === 'string' && req.query[key] ? String(req.query[key]) : undefined);
  const events = filterAudit(companyAudit(companyId), {
    actorId: text('actorId'), action: text('action'), entityType: text('entityType'), entityId: text('entityId'), from: text('from'), to: text('to'),
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50_000);
  const names = new Map(listUsersByCompany(companyId).map((user) => [user.id, user.name]));
  if (req.query.format === 'json') return res.json({ count: events.length, events });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(auditCsv(events, names));
});

// Week 19 execution-guide scope: SLO thresholds for the business SLIs below,
// each with a "why this number" so a later change is a deliberate edit, not
// a guess. These are read here rather than enforced by an external alerting
// system - this repo has no paging/alerting connector to route to, so the
// honest deliverable is a visible, queryable breach flag on this endpoint,
// not a fabricated "alerts configured" claim.
const OUTBOX_LAG_BREACH_SECONDS = 15 * 60; // Delivery/backoff retries every few seconds; 15 minutes stuck means the worker itself is stuck, not just backing off.
const OUTBOX_POISON_BREACH_COUNT = 1; // Any POISON row is a silently-failing event by definition (Week 7); zero tolerance.

// Blueprint v4 §40 Observability: request latency/error by route, sync health, stuck transfers.
router.get('/ops/metrics', ...guard, async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Operational metrics are for admins.' });
  const memory = process.memoryUsage();
  const database = databaseEnabled
    ? await databaseProbe().catch((error) => ({ ok: false as const, code: error instanceof Error ? error.name : 'DATABASE_PROBE_FAILED' }))
    : { ok: true as const, mode: 'memory' as const };
  const outbox = await outboxHealthSnapshot().catch((error) => {
    console.warn('[command-center] outbox health unavailable:', error instanceof Error ? error.message : error);
    return undefined;
  });
  return res.json({
    generatedAt: new Date().toISOString(),
    api: metricsSnapshot(),
    sync: { liveClients: subscriberCount(), lastEventId: latestEventId() },
    warehouse: { stuckTransfers: stuckTransfers(listTransfers(), new Date()).rows.length },
    process: { rssMb: Math.round(memory.rss / 1_048_576), heapUsedMb: Math.round(memory.heapUsed / 1_048_576), node: process.version },
    database: { connected: databaseEnabled, ...database },
    outbox: outbox && {
      ...outbox,
      slo: {
        lagBreachSeconds: OUTBOX_LAG_BREACH_SECONDS,
        poisonBreachCount: OUTBOX_POISON_BREACH_COUNT,
        breached: outbox.oldestPendingAgeSeconds >= OUTBOX_LAG_BREACH_SECONDS || outbox.poison >= OUTBOX_POISON_BREACH_COUNT,
      },
    },
  });
});

export default router;
