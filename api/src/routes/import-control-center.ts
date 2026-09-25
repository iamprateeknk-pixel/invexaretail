import { Router, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { canAccessLocation } from '../lib/inventory.js';
import { listLocations, listSyncCheckpoints } from '../lib/repository.js';
import { locationsForCompany, DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { buildControlCenter, dayWindow, todayFor } from '../lib/import-control-center.js';
import { loadMovementActivity, loadRejectedRows } from '../lib/import-control-center-service.js';
import { countsNeedingReconciliation } from '../lib/late-movement-service.js';
import { DEFAULT_CAMPAIGN_TIMEZONE, isDateOnly, isValidTimezone } from '../lib/stock-take-campaign.js';

// Blueprint v4 §10.1: where does each branch stand on today's sales and
// purchase files - uploaded, partial or missing - before managers rely on
// stock accuracy.
const router = Router();

router.get('/imports/control-center', extractToken, requireAuth, async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(role)) {
    return res.status(403).json({ message: 'Import control center access denied.' });
  }
  const timezone = typeof req.query.timezone === 'string' && req.query.timezone ? req.query.timezone : DEFAULT_CAMPAIGN_TIMEZONE;
  if (!isValidTimezone(timezone)) return res.status(400).json({ message: 'timezone is not a valid IANA timezone.' });
  const date = req.query.date === undefined ? todayFor(timezone) : req.query.date;
  if (!isDateOnly(date)) return res.status(400).json({ message: 'date must be a YYYY-MM-DD date.' });

  const companyId = req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID;
  const context = { role: role as 'ADMIN', assignedLocationIds: req.user!.locationIds ?? [], companyId };
  const locations = locationsForCompany(companyId, listLocations()).filter((location) => canAccessLocation(context, location.id));
  const visible = new Set(locations.map((location) => location.id));

  try {
    const window = dayWindow(date, timezone);
    const activity = (await loadMovementActivity(window.from, window.to)).filter((row) => visible.has(row.locationId));
    const batchIds = activity.flatMap((row) => row.batchIds);
    const rejected = await loadRejectedRows(companyId, batchIds, locations);
    const report = buildControlCenter({
      date, timezone, locations, activity,
      rejectedByLocation: rejected.byLocation,
      unattributedRejected: rejected.unattributed,
    });
    const checkpoints = listSyncCheckpoints().filter((row) => visible.has(row.locationId));
    // Blueprint v4 §14: counts whose book quantity a late-arriving movement changed.
    const flagged = countsNeedingReconciliation().filter((count) => visible.has(count.locationId));
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
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'Import status is unavailable.' });
  }
});

export default router;
