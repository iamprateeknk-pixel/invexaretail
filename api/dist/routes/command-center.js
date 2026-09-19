"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const db_js_1 = require("../lib/db.js");
const audit_js_1 = require("../lib/audit.js");
const event_bus_js_1 = require("../lib/event-bus.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const repository_js_1 = require("../lib/repository.js");
const persistence_js_1 = require("../lib/persistence.js");
const command_center_js_1 = require("../lib/command-center.js");
const request_metrics_js_1 = require("../lib/request-metrics.js");
const command_center_js_2 = require("../lib/command-center.js");
const report_builders_js_1 = require("../lib/report-builders.js");
// Blueprint v4 §29 Command Center and §30 Reports. Read-only.
const router = (0, express_1.Router)();
const guard = [enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth];
const MANAGEMENT = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'];
function scope(req) {
    const user = req.user;
    const companyId = req.companyId ?? user.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID;
    const all = user.role === 'ADMIN' || user.role === 'ADMIN_USER' || user.role === 'AUDITOR' && !(user.locationIds ?? []).length;
    const allowed = (locationId) => (0, tenant_scope_js_1.companyOwnsLocation)(companyId, locationId) && (all || (user.locationIds ?? []).includes(locationId));
    return { companyId, allowed };
}
function deny(res) {
    return res.status(403).json({ message: 'The command center is for admins, branch managers and auditors.' });
}
// The parts only the database holds; a failure here never takes the dashboard down.
async function databaseExtras() {
    if (!persistence_js_1.databaseEnabled)
        return undefined;
    try {
        const open = ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL'];
        const [openCount, critical, overdue, pending] = await Promise.all([
            db_js_1.prisma.exceptionCase.count({ where: { status: { in: open } } }),
            db_js_1.prisma.exceptionCase.count({ where: { status: { in: open }, priority: 'CRITICAL' } }),
            db_js_1.prisma.exceptionCase.count({ where: { status: { in: open }, dueAt: { lt: new Date() } } }),
            db_js_1.prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
        ]);
        return { exceptions: { open: openCount, critical, overdue }, approvals: { pending } };
    }
    catch (error) {
        console.warn('[command-center] database extras unavailable:', error instanceof Error ? error.message : error);
        return undefined;
    }
}
router.get('/command-center', ...guard, async (req, res) => {
    if (!MANAGEMENT.includes(req.user.role))
        return deny(res);
    const { companyId, allowed } = scope(req);
    const locations = (0, repository_js_1.listLocations)().filter((location) => allowed(location.id));
    const locationIds = new Set(locations.map((location) => location.id));
    const users = new Map((0, enterprise_repository_js_1.listUsersByCompany)(companyId).map((user) => [user.id, user.name]));
    const center = (0, command_center_js_1.buildCommandCenter)({
        now: new Date(),
        locations,
        counts: (0, repository_js_1.listCounts)().filter((count) => locationIds.has(count.locationId)),
        assignments: (0, repository_js_1.listCountAssignments)().filter((row) => locationIds.has(row.locationId)),
        transfers: (0, repository_js_1.listTransfers)().filter((transfer) => locationIds.has(transfer.sourceLocationId) || locationIds.has(transfer.destinationLocationId)),
        checkpoints: (0, repository_js_1.listSyncCheckpoints)().filter((row) => locationIds.has(row.locationId)),
        audit: (0, audit_js_1.listAuditEvents)(),
        userNames: users,
        live: { clients: (0, event_bus_js_1.subscriberCount)(), lastEventId: (0, event_bus_js_1.latestEventId)() },
        extras: await databaseExtras(),
    });
    return res.json({ commandCenter: center });
});
router.get('/reports/transfer-cycle', ...guard, (req, res) => {
    if (!MANAGEMENT.includes(req.user.role))
        return res.status(403).json({ message: 'Reports require Admin, Branch Manager or Auditor access.' });
    const { allowed } = scope(req);
    const transfers = (0, repository_js_1.listTransfers)().filter((transfer) => allowed(transfer.sourceLocationId) || allowed(transfer.destinationLocationId));
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    return res.json({ report: (0, report_builders_js_1.transferCycleReport)(transfers, (0, audit_js_1.listAuditEvents)(), { from, to }) });
});
router.get('/reports/count-accuracy', ...guard, (req, res) => {
    if (!MANAGEMENT.includes(req.user.role))
        return res.status(403).json({ message: 'Reports require Admin, Branch Manager or Auditor access.' });
    const groupBy = (['branch', 'user', 'category'].includes(String(req.query.groupBy)) ? String(req.query.groupBy) : 'branch');
    const { companyId, allowed } = scope(req);
    return res.json({
        groupBy,
        rows: (0, report_builders_js_1.countAccuracyReport)({
            counts: (0, repository_js_1.listCounts)().filter((count) => allowed(count.locationId)),
            items: (0, repository_js_1.listItems)(),
            groupBy,
            labels: { locations: new Map((0, repository_js_1.listLocations)().map((location) => [location.id, location.name])), users: new Map((0, enterprise_repository_js_1.listUsersByCompany)(companyId).map((user) => [user.id, user.name])) },
            range: { from: typeof req.query.from === 'string' ? req.query.from : undefined, to: typeof req.query.to === 'string' ? req.query.to : undefined },
        }),
    });
});
// Blueprint §30: "Full audit export by actor/action/entity/date."
router.get('/reports/audit-export', ...guard, (req, res) => {
    if (!['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user.role))
        return res.status(403).json({ message: 'The audit export requires Admin or Auditor access.' });
    const { companyId } = scope(req);
    const text = (key) => (typeof req.query[key] === 'string' && req.query[key] ? String(req.query[key]) : undefined);
    const events = (0, report_builders_js_1.filterAudit)((0, audit_js_1.listAuditEvents)(), {
        actorId: text('actorId'), action: text('action'), entityType: text('entityType'), entityId: text('entityId'), from: text('from'), to: text('to'),
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50_000);
    const names = new Map((0, enterprise_repository_js_1.listUsersByCompany)(companyId).map((user) => [user.id, user.name]));
    if (req.query.format === 'json')
        return res.json({ count: events.length, events });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send((0, report_builders_js_1.auditCsv)(events, names));
});
// Blueprint v4 §40 Observability: request latency/error by route, sync health, stuck transfers.
router.get('/ops/metrics', ...guard, (req, res) => {
    if (!['ADMIN', 'ADMIN_USER'].includes(req.user.role))
        return res.status(403).json({ message: 'Operational metrics are for admins.' });
    const memory = process.memoryUsage();
    return res.json({
        generatedAt: new Date().toISOString(),
        api: (0, request_metrics_js_1.metricsSnapshot)(),
        sync: { liveClients: (0, event_bus_js_1.subscriberCount)(), lastEventId: (0, event_bus_js_1.latestEventId)() },
        warehouse: { stuckTransfers: (0, command_center_js_2.stuckTransfers)((0, repository_js_1.listTransfers)(), new Date()).rows.length },
        process: { rssMb: Math.round(memory.rss / 1_048_576), heapUsedMb: Math.round(memory.heapUsed / 1_048_576), node: process.version },
        database: { connected: persistence_js_1.databaseEnabled },
    });
});
exports.default = router;
