"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const inventory_js_1 = require("../lib/inventory.js");
const repository_js_1 = require("../lib/repository.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const import_control_center_js_1 = require("../lib/import-control-center.js");
const import_control_center_service_js_1 = require("../lib/import-control-center-service.js");
const late_movement_service_js_1 = require("../lib/late-movement-service.js");
const stock_take_campaign_js_1 = require("../lib/stock-take-campaign.js");
// Blueprint v4 §10.1: where does each branch stand on today's sales and
// purchase files - uploaded, partial or missing - before managers rely on
// stock accuracy.
const router = (0, express_1.Router)();
router.get('/imports/control-center', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, async (req, res) => {
    const role = req.user.role;
    if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(role)) {
        return res.status(403).json({ message: 'Import control center access denied.' });
    }
    const timezone = typeof req.query.timezone === 'string' && req.query.timezone ? req.query.timezone : stock_take_campaign_js_1.DEFAULT_CAMPAIGN_TIMEZONE;
    if (!(0, stock_take_campaign_js_1.isValidTimezone)(timezone))
        return res.status(400).json({ message: 'timezone is not a valid IANA timezone.' });
    const date = req.query.date === undefined ? (0, import_control_center_js_1.todayFor)(timezone) : req.query.date;
    if (!(0, stock_take_campaign_js_1.isDateOnly)(date))
        return res.status(400).json({ message: 'date must be a YYYY-MM-DD date.' });
    const companyId = req.companyId ?? req.user.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID;
    const context = { role: role, assignedLocationIds: req.user.locationIds ?? [], companyId };
    const locations = (0, tenant_scope_js_1.locationsForCompany)(companyId, (0, repository_js_1.listLocations)()).filter((location) => (0, inventory_js_1.canAccessLocation)(context, location.id));
    const visible = new Set(locations.map((location) => location.id));
    try {
        const window = (0, import_control_center_js_1.dayWindow)(date, timezone);
        const activity = (await (0, import_control_center_service_js_1.loadMovementActivity)(window.from, window.to)).filter((row) => visible.has(row.locationId));
        const batchIds = activity.flatMap((row) => row.batchIds);
        const rejected = await (0, import_control_center_service_js_1.loadRejectedRows)(batchIds, locations);
        const report = (0, import_control_center_js_1.buildControlCenter)({
            date, timezone, locations, activity,
            rejectedByLocation: rejected.byLocation,
            unattributedRejected: rejected.unattributed,
        });
        const checkpoints = (0, repository_js_1.listSyncCheckpoints)().filter((row) => visible.has(row.locationId));
        // Blueprint v4 §14: counts whose book quantity a late-arriving movement changed.
        const flagged = (0, late_movement_service_js_1.countsNeedingReconciliation)().filter((count) => visible.has(count.locationId));
        return res.json({
            ...report,
            reconciliation: {
                required: flagged.length,
                counts: flagged.slice(0, 50).map((count) => ({
                    id: count.id, itemId: count.itemId, locationId: count.locationId, status: count.status,
                    lateDelta: count.lateDelta ?? 0, bookQtyOriginal: count.bookQtyOriginal, bookQty: count.bookQty, note: count.reconciliationNote, at: count.reconciliationAt,
                })),
            },
            window,
            checkpoints: locations.map((location) => ({
                locationId: location.id,
                locationName: location.name,
                salesSyncedThrough: checkpoints.find((row) => row.locationId === location.id && row.sourceType === 'SALES')?.syncedThroughAt ?? null,
                purchaseSyncedThrough: checkpoints.find((row) => row.locationId === location.id && row.sourceType === 'PURCHASE')?.syncedThroughAt ?? null,
            })),
        });
    }
    catch (error) {
        return res.status(503).json({ message: error instanceof Error ? error.message : 'Import status is unavailable.' });
    }
});
exports.default = router;
