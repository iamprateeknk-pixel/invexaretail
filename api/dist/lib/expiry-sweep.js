"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sweepExpiredLots = sweepExpiredLots;
exports.startExpirySweep = startExpirySweep;
exports.stopExpirySweep = stopExpirySweep;
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const expiry_date_js_1 = require("./expiry-date.js");
const company_timezone_js_1 = require("./company-timezone.js");
const timezone_context_js_1 = require("./timezone-context.js");
// Audit S-3: nothing ever moved a lot to EXPIRED when its date passed - the status was
// only set as a side effect of a manual write-off - so reports, transfers and any path
// that trusts `Lot.status` kept treating lapsed stock as AVAILABLE. This daily sweep
// marks every AVAILABLE lot whose expiry date is before today (business timezone) as
// EXPIRED. It only changes the status flag (never quantity - write-off stays a
// controlled, audited human action) and is idempotent.
let timer = null;
async function sweepExpiredLots(now = new Date()) {
    // A lot is expired once its date is before today in ITS COMPANY's timezone (audit T-2), so candidates are
    // fetched with a coarse cutoff (the furthest-ahead zone is UTC+14) and judged per company.
    await (0, company_timezone_js_1.loadCompanyTimezones)().catch(() => undefined);
    const candidates = await db_js_1.prisma.lot.findMany({
        where: { status: 'AVAILABLE', expiryDate: { lt: new Date(now.getTime() + 2 * 86_400_000) } },
        select: { id: true, expiryDate: true, item: { select: { companyId: true } } },
    });
    const stale = candidates.filter((lot) => (0, expiry_date_js_1.isExpiredOn)(lot.expiryDate, now, (0, timezone_context_js_1.companyTimezone)(lot.item.companyId)));
    if (!stale.length)
        return { expired: 0 };
    const result = await db_js_1.prisma.lot.updateMany({
        where: { id: { in: stale.map((lot) => lot.id) }, status: 'AVAILABLE' },
        data: { status: 'EXPIRED' },
    });
    await db_js_1.prisma.auditLog.create({
        data: {
            id: (0, node_crypto_1.randomUUID)(), actorId: 'system', actorRole: 'SYSTEM', action: 'LOTS_MARKED_EXPIRED',
            entityType: 'Lot', entityId: 'sweep', tenantId: 'tenant-invexa',
            metadata: { count: result.count, lotIds: stale.slice(0, 200).map((lot) => lot.id) },
        },
    }).catch(() => undefined);
    return { expired: result.count };
}
/** Runs once at start-up and then every `intervalMs` (default 6 h, so a lot flips within hours of IST midnight). */
function startExpirySweep(intervalMs = 6 * 60 * 60 * 1000) {
    if (timer)
        return;
    const run = () => sweepExpiredLots().catch((error) => console.error('[expiry-sweep] failed', error));
    void run();
    timer = setInterval(run, intervalMs);
    timer.unref?.();
}
function stopExpirySweep() {
    if (timer)
        clearInterval(timer);
    timer = null;
}
