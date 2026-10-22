// Demand-forecast + intelligence routes for operations-extension
// (Phase 4): extracted verbatim from operations-extension.ts; the
// composer mounts this router at the cluster's original position.
import { loadSalesEvents, signedSalesQty, totalsByItem } from '../lib/sales-demand.js';
import { decimalsToNumbers } from '../lib/decimal-json.js';
import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { planRuleReplenishment } from '../lib/replenishment.js';
import { sellableQuantity, totalSellable } from '../lib/sellable-stock.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { buildReplenishmentIntelligence, listReorderRules } from '../lib/reorder-store.js';
import { listItems, listLocations } from '../lib/repository.js';
import { listStockForCompany } from '../lib/repositories/stock-repository.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { censorStockoutDays, classifyDemandPattern, computeDemandStats, openingBalancesByDay, crostonDailyDemand, suggestReplenishment, xyzClass } from '../lib/demand-forecast.js';
import { OPEN_PO_STATUSES } from '../lib/po-planning.js';
import { buildExpiryActionRecommendations, buildLotBlockRecommendations, buildOverstockRecommendations } from '../lib/intelligence-actions.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import { canAccessLocation } from './opext-shared.js';

const router = Router();

router.get('/items/:itemId/forecast', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) return res.status(501).json({ message: 'Forecasting requires a connected database.' });

  const windowDays = Number(req.query.windowDays) > 0 ? Number(req.query.windowDays) : 30;
  const leadTimeDays = Number(req.query.leadTimeDays) > 0 ? Number(req.query.leadTimeDays) : 7;
  const servicePercent = Number(req.query.servicePercent) > 0 ? Number(req.query.servicePercent) : 95;
  if (servicePercent < 50 || servicePercent > 99.99) return res.status(400).json({ message: 'servicePercent must be between 50 and 99.99.' });
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const movements = await loadSalesEvents({ since, locationId, itemIds: [req.params.itemId] });
  // Demand is NET sales: a return in the window offsets a sale (it used to be ignored, overstating demand).
  const soldByDay = new Map<string, number>();
  for (const movement of movements) {
    const day = movement.timestamp.toISOString().slice(0, 10);
    soldByDay.set(day, (soldByDay.get(day) ?? 0) + movement.qty);
  }
  const dailyDemand: number[] = [];
  for (let offset = 0; offset < windowDays; offset += 1) {
    const day = new Date(since.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dailyDemand.push(soldByDay.get(day) ?? 0);
  }
  // Days with nothing on the shelf are censored, not counted as zero demand (audit O-2).
  const allMovements = await prisma.stockMovement.findMany({ where: { itemId: req.params.itemId, locationId, timestamp: { gte: since } }, select: { qtyDelta: true, timestamp: true } });
  const currentLedger = await prisma.stockLedger.findMany({ where: { itemId: req.params.itemId, locationId }, select: { onHand: true } });
  const opening = openingBalancesByDay({ currentOnHand: currentLedger.reduce((sum, row) => sum + Number(row.onHand), 0), movements: allMovements.map((m) => ({ ...m, qtyDelta: Number(m.qtyDelta) })), windowStart: since, windowDays });
  const censored = censorStockoutDays(dailyDemand.map((value) => Math.max(0, value)), opening);
  const netDailyDemand = censored.demand.length ? censored.demand : dailyDemand.map((value) => Math.max(0, value));
  const plainDemand = computeDemandStats(netDailyDemand);
  const { pattern: demandPattern } = classifyDemandPattern(netDailyDemand);
  // Sparse items are forecast with Croston (SBA); averaging their zeros misstates the rate (audit O-2).
  const intermittent = demandPattern === 'INTERMITTENT' || demandPattern === 'LUMPY';
  const demand = intermittent ? { ...plainDemand, averageDailyDemand: crostonDailyDemand(netDailyDemand) } : plainDemand;

  const ledgerRows = await prisma.stockLedger.findMany({ where: { itemId: req.params.itemId, locationId }, include: { lot: { select: { status: true, expiryDate: true } } } });
  // Cover is sellable stock only: blocked, quarantined and expired lots do not count (audit O-6).
  const onHand = totalSellable(ledgerRows.map((row) => ({ ...row, onHand: Number(row.onHand), reserved: Number(row.reserved) })));
  const openLines = await prisma.purchaseOrderLine.findMany({
    where: { itemId: req.params.itemId, purchaseOrder: { locationId, status: { in: [...OPEN_PO_STATUSES] } } },
  });
  const onOrder = openLines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.receivedQty), 0);

  const suggestion = suggestReplenishment({ onHand, onOrder, demand, averageLeadTimeDays: leadTimeDays, servicePercent });

  const item = await prisma.item.findFirst({ where: { id: req.params.itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { name: true, shelfLifeDays: true } });
  const lots = await prisma.lot.findMany({
    where: { itemId: req.params.itemId, stock: { some: { locationId, onHand: { gt: 0 } } } },
    include: { stock: { where: { locationId } } },
  }).catch(() => []);
  const lotInputs = lots.flatMap((lot) => lot.stock.filter((row) => Number(row.onHand) > 0).map((row) => ({
    itemId: req.params.itemId,
    itemName: item?.name ?? req.params.itemId,
    lotId: lot.id,
    lotNo: lot.lotNo,
    locationId: row.locationId,
    onHand: Number(row.onHand),
    status: lot.status,
    expiryDate: lot.expiryDate?.toISOString() ?? null,
  })));
  const expiryActions = buildExpiryActionRecommendations(lotInputs, new Date(), {
    demandByItem: demand.sampleDays > 0 ? new Map([[req.params.itemId, demand.averageDailyDemand]]) : undefined,
    shelfLifeByItem: new Map([[req.params.itemId, item?.shelfLifeDays]]),
  });

  const rules = decimalsToNumbers(await prisma.reorderRule.findMany({ where: { itemId: req.params.itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } }));
  const networkLedger = await prisma.stockLedger.findMany({
    where: { itemId: req.params.itemId },
    select: { locationId: true, onHand: true, location: { select: { name: true } } },
  });
  const overstockRows = rules.map((rule) => {
    const here = networkLedger.filter((row) => row.locationId === rule.locationId).reduce((sum, row) => sum + Number(row.onHand), 0);
    const location = networkLedger.find((row) => row.locationId === rule.locationId)?.location;
    return {
      itemId: req.params.itemId,
      itemName: item?.name ?? req.params.itemId,
      locationId: rule.locationId,
      locationName: location?.name ?? rule.locationId,
      onHand: here,
      targetQty: rule.targetQty,
      minQty: rule.minQty,
    };
  });
  const overstock = buildOverstockRecommendations(overstockRows, locationId);

  return res.json({
    itemId: req.params.itemId, locationId, windowDays, leadTimeDays, servicePercent,
    demand, demandPattern, variabilityClass: xyzClass(netDailyDemand), forecastMethod: intermittent ? 'CROSTON_SBA' : 'MOVING_AVERAGE', stockoutDaysExcluded: censored.censoredDays,
    onHand, onOrder, suggestion, expiryActions, overstock,
  });
});

// A dismissal hides a recommendation for 24h, then it resurfaces if still
// genuinely valid - see the IntelligenceDismissal model comment.
const INTELLIGENCE_DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;

router.get('/intelligence/:locationId', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Intelligence insights require Admin or Auditor access.' });
  if (!canAccessLocation(req, req.params.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) {
    const locationId = req.params.locationId;
    const items = listItems();
    const locations = listLocations();
    // Phase 5 step 5: the memory branch's stock input also comes through
    // the stock repository (its memory implementation), so both branches
    // of this endpoint now draw stock from one place and the builder below
    // reconciles with the database branch's math (see reorder-store.ts).
    const ledger = await listStockForCompany({
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      tenantId: DEFAULT_TENANT_ID,
      userId: req.user!.id,
      role: req.user!.role as TenantContext['role'],
    });
    const lotInputs = ledger.filter((row) => row.locationId === locationId && row.onHand > 0).map((row) => {
      const item = items.find((entry) => entry.id === row.itemId);
      const lot = item?.lots.find((entry) => entry.id === row.lotId);
      return {
        itemId: row.itemId,
        itemName: item?.name ?? row.itemId,
        lotId: row.lotId,
        lotNo: lot?.lotNo ?? row.lotId,
        locationId: row.locationId,
        onHand: row.onHand,
        status: lot?.status ?? 'AVAILABLE',
        expiryDate: lot?.expiryDate ?? null,
      };
    });
    const overstockRows = listReorderRules(locationId).flatMap((rule) => {
      const item = items.find((entry) => entry.id === rule.itemId);
      return locations.map((location) => {
        const onHand = ledger
          .filter((row) => row.itemId === rule.itemId && row.locationId === location.id)
          .reduce((sum, row) => sum + row.onHand, 0);
        return {
          itemId: rule.itemId,
          itemName: item?.name ?? rule.itemId,
          locationId: location.id,
          locationName: location.name,
          onHand,
          targetQty: rule.targetQty,
          minQty: rule.minQty,
        };
      });
    });
    return res.json({
      intelligence: {
        ...buildReplenishmentIntelligence(locationId, ledger),
        lotBlocks: buildLotBlockRecommendations(lotInputs),
        expiryActions: buildExpiryActionRecommendations(lotInputs),
        overstock: buildOverstockRecommendations(overstockRows, locationId),
      },
    });
  }
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const dismissedSince = new Date(Date.now() - INTELLIGENCE_DISMISSAL_TTL_MS);
  const [rules, ledger, counts, dismissals, destinationLocation] = await Promise.all([
    prisma.reorderRule.findMany({ where: { locationId: req.params.locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { item: true } }).then((rows) => decimalsToNumbers(rows)),
    // Scoped to this company's locations (it used to read every tenant's whole ledger on each request)
    // and to the items that have rules, with the lot fields needed to judge what is sellable.
    prisma.stockLedger.findMany({
      where: { location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
      select: { itemId: true, locationId: true, onHand: true, reserved: true, inTransit: true, lot: { select: { status: true, expiryDate: true } }, location: { select: { name: true, type: true, latitude: true, longitude: true, shippingCostPerKm: true, deliverySlaHours: true } } },
    }),
    prisma.stockCount.findMany({ where: { locationId: req.params.locationId, countDate: { gte: since }, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { item: true }, orderBy: { countDate: 'desc' }, take: 250 }).then((rows) => decimalsToNumbers(rows)),
    prisma.intelligenceDismissal.findMany({ where: { locationId: req.params.locationId, createdAt: { gte: dismissedSince } } }),
    // Audit R-1: donors are ranked by estimated shipping cost/lead time when this and the donor both have coordinates.
    prisma.location.findFirst({ where: { id: req.params.locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { latitude: true, longitude: true, shippingCostPerKm: true } }),
  ]);
  const dismissedItemIds = new Set(dismissals.filter((d) => d.type === 'REPLENISHMENT').map((d) => d.itemId));
  const dismissedCountIds = new Set(dismissals.filter((d) => d.type === 'ANOMALY' && d.countId).map((d) => d.countId));
  const quantities = new Map<string, { onHand: number; reserved: number; inTransit: number }>();
  const network = new Map<string, Map<string, { locationId: string; locationName: string; locationType: string; available: number }>>();
  for (const entry of ledger) {
    if (entry.locationId === req.params.locationId) {
      const current = quantities.get(entry.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
      const sellableHere = sellableQuantity({ onHand: Number(entry.onHand), reserved: 0, lot: entry.lot });
      current.onHand += sellableHere;
      current.reserved += sellableHere > 0 ? Number(entry.reserved) : 0;
      current.inTransit += Number(entry.inTransit);
      quantities.set(entry.itemId, current);
    }
    const byLocation = network.get(entry.itemId) ?? new Map();
    const source = byLocation.get(entry.locationId) ?? {
      locationId: entry.locationId,
      locationName: entry.location.name,
      locationType: entry.location.type,
      available: 0,
      latitude: entry.location.latitude,
      longitude: entry.location.longitude,
      shippingCostPerKm: entry.location.shippingCostPerKm == null ? null : Number(entry.location.shippingCostPerKm),
      deliverySlaHours: entry.location.deliverySlaHours,
    };
    source.available += sellableQuantity({ onHand: Number(entry.onHand), reserved: Number(entry.reserved), lot: entry.lot });
    byLocation.set(entry.locationId, source);
    network.set(entry.itemId, byLocation);
  }
  // StockLedger.inTransit is never written (dispatch does not post to it), so stock already
  // on its way is read from the Transfer table - the same source the purchase plan uses. Fetched
  // company-wide (not just this location) so the overstock/network-need calc below (audit R-1:
  // "they use on-hand, not available - reserved/in-transit ignored") can also see what is already
  // headed to a DIFFERENT needy store, not only what is headed here.
  const inboundTransfers = await prisma.transfer.findMany({
    where: { status: { in: ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'] }, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    include: { lines: true },
  });
  const incoming = new Map<string, number>();
  const networkIncoming = new Map<string, number>();
  for (const transfer of inboundTransfers) {
    for (const line of transfer.lines) {
      const qty = Math.max(0, Number(line.requestedQty) - Number(line.receivedQty) - Number(line.damagedQty) - Number(line.shortageQty));
      if (transfer.destinationLocationId === req.params.locationId) incoming.set(line.itemId, (incoming.get(line.itemId) ?? 0) + qty);
      const key = `${line.itemId}|${transfer.destinationLocationId}`;
      networkIncoming.set(key, (networkIncoming.get(key) ?? 0) + qty);
    }
  }
  // A donor keeps its own reorder minimum for the item.
  const donorRules = decimalsToNumbers(await prisma.reorderRule.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, itemId: { in: rules.map((rule) => rule.itemId) } },
    select: { itemId: true, locationId: true, minQty: true },
  }));
  const minimumAt = (itemId: string, donorLocationId: string) => donorRules.find((row) => row.itemId === itemId && row.locationId === donorLocationId)?.minQty ?? 0;

  const recommendations = rules.map((rule) => {
    const stock = quantities.get(rule.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
    const plan = planRuleReplenishment({
      destinationLocationId: req.params.locationId,
      availableHere: stock.onHand - stock.reserved,
      incoming: incoming.get(rule.itemId) ?? 0,
      minQty: rule.minQty, targetQty: rule.targetQty,
      network: [...(network.get(rule.itemId)?.values() ?? [])].map((row) => ({ ...row, protectedQty: minimumAt(rule.itemId, row.locationId) })),
      destination: destinationLocation ? decimalsToNumbers(destinationLocation) : undefined,
    });
    const available = plan.position;
    const suggestedOrderQty = plan.suggestedOrderQty;
    const route = plan.route;
    const history = counts.filter((count) => count.itemId === rule.itemId);
    const meanVariance = history.length ? history.reduce((sum, count) => sum + Math.abs(count.physicalQty - count.bookQty), 0) / history.length : 0;
    return {
      itemId: rule.itemId,
      itemName: rule.item.name,
      available,
      minQty: rule.minQty,
      targetQty: rule.targetQty,
      suggestedOrderQty,
      suggestedAction: route.action,
      sourceLocationId: route.sourceLocationId,
      sourceLocationName: route.sourceLocationName,
      suggestedTransferQty: route.suggestedTransferQty,
      actionReason: route.reason,
      risk: plan.risk,
      confidence: history.length >= 3 && meanVariance <= Math.max(1, rule.minQty * 0.1) ? 'HIGH' : history.length ? 'MEDIUM' : 'LOW',
    };
  }).filter((entry) => !dismissedItemIds.has(entry.itemId)).sort((a, b) => b.suggestedOrderQty - a.suggestedOrderQty);
  const anomalies = counts
    .map((count) => ({ itemId: count.itemId, itemName: count.item.name, countId: count.id, bookQty: count.bookQty, physicalQty: count.physicalQty, variance: count.physicalQty - count.bookQty, countDate: count.countDate }))
    .filter((count) => Math.abs(count.variance) >= Math.max(3, Math.abs(count.bookQty) * 0.1))
    .filter((count) => !dismissedCountIds.has(count.countId))
    .slice(0, 20);
  const critical = recommendations.filter((entry) => entry.risk === 'CRITICAL').length;
  const transfers = recommendations.filter((entry) => entry.suggestedAction === 'TRANSFER').length;
  const purchases = recommendations.filter((entry) => entry.suggestedAction === 'PURCHASE').length;
  const executiveSummary = critical
    ? `${critical} critical item${critical === 1 ? '' : 's'}; ${transfers} network transfer${transfers === 1 ? '' : 's'} and ${purchases} purchase action${purchases === 1 ? '' : 's'} recommended.`
    : transfers || purchases
      // The purchase hub is per-company and chosen dynamically (each recommendation's own
      // `actionReason` already names it) - this summary line used to hard-code one customer's
      // site ("H.O. Basni") regardless of the actual configured warehouse (audit R-1 leftover).
      ? `${transfers} network transfer${transfers === 1 ? '' : 's'} and ${purchases} warehouse purchase action${purchases === 1 ? '' : 's'} recommended.`
      : 'Configured inventory is above reorder targets. Continue monitoring count variance.';

  const lots = await prisma.lot.findMany({
    where: { stock: { some: { locationId: req.params.locationId, onHand: { gt: 0 } } } },
    include: { item: { select: { id: true, name: true, shelfLifeDays: true } }, stock: { where: { locationId: req.params.locationId } } },
    take: 400,
  }).catch(() => []);
  // Recent sales rate per item here, so expiry advice can ask "will it sell before it expires?".
  const salesSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentSales = [...totalsByItem(await loadSalesEvents({ since: salesSince, locationId: req.params.locationId }).catch(() => [])).entries()].map(([itemId, units]) => ({ itemId, units: Math.max(0, units) }));
  const demandByItem = new Map<string, number>(recentSales.map((row) => [row.itemId, row.units / 30] as [string, number]));
  // Items with no sales at all in the window are known-zero demand only if we actually have sales history for the location.
  if (recentSales.length > 0) for (const lot of lots) if (!demandByItem.has(lot.itemId)) demandByItem.set(lot.itemId, 0);
  const shelfLifeByItem = new Map<string, number | null | undefined>(lots.map((lot) => [lot.itemId, lot.item.shelfLifeDays] as [string, number | null | undefined]));
  // Other locations' demand for these same items, so an expiring lot can be offered a TRANSFER to
  // a genuinely faster-selling branch instead of only ever MARKDOWN here (audit R-1).
  const expiringItemIds = [...new Set(lots.map((lot) => lot.itemId))];
  const networkMovements = expiringItemIds.length
    ? await prisma.stockMovement.findMany({
        where: { itemId: { in: expiringItemIds }, movementType: { in: ['SALES_DEDUCTION', 'SALES_RETURN'] }, timestamp: { gte: salesSince }, location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
        select: { itemId: true, locationId: true, qtyDelta: true, movementType: true },
      }).catch(() => [])
    : [];
  const networkUnitsByKey = new Map<string, number>();
  for (const m of networkMovements) {
    const key = `${m.itemId}|${m.locationId}`;
    networkUnitsByKey.set(key, (networkUnitsByKey.get(key) ?? 0) + signedSalesQty(m.movementType, Number(m.qtyDelta)));
  }
  const networkByItem = new Map<string, Array<{ locationId: string; locationName: string; avgDailyDemand: number; onHand: number }>>();
  for (const itemId of expiringItemIds) {
    const locations = [...(network.get(itemId)?.values() ?? [])]
      .filter((entry) => entry.locationId !== req.params.locationId)
      .map((entry) => ({
        locationId: entry.locationId, locationName: entry.locationName, onHand: entry.available,
        avgDailyDemand: Math.max(0, (networkUnitsByKey.get(`${itemId}|${entry.locationId}`) ?? 0) / 30),
      }));
    if (locations.length) networkByItem.set(itemId, locations);
  }
  const lotInputs = lots.flatMap((lot) => lot.stock.filter((row) => Number(row.onHand) > 0).map((row) => ({
    itemId: lot.itemId,
    itemName: lot.item.name,
    lotId: lot.id,
    lotNo: lot.lotNo,
    locationId: row.locationId,
    onHand: Number(row.onHand),
    status: lot.status,
    expiryDate: lot.expiryDate?.toISOString() ?? null,
  })));
  const dismissedTypes = new Set(dismissals.map((row) => `${row.type}:${row.itemId}`));
  const lotBlocks = buildLotBlockRecommendations(lotInputs).filter((row) => !dismissedTypes.has(`LOT_BLOCK:${row.itemId}`));
  const expiryActions = buildExpiryActionRecommendations(lotInputs, new Date(), { demandByItem, shelfLifeByItem, networkByItem }).filter((row) => !dismissedTypes.has(`EXPIRY:${row.itemId}`));
  const overstockRows = rules.flatMap((rule) => {
    const here = quantities.get(rule.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
    const networkRows = [...(network.get(rule.itemId)?.values() ?? [])].map((entry) => ({
      itemId: rule.itemId,
      itemName: rule.item.name,
      locationId: entry.locationId,
      locationName: entry.locationName,
      onHand: entry.available + (entry.locationId === req.params.locationId ? here.reserved : 0),
      targetQty: rule.targetQty,
      minQty: rule.minQty,
    }));
    if (!networkRows.some((row) => row.locationId === req.params.locationId)) {
      networkRows.push({
        itemId: rule.itemId, itemName: rule.item.name, locationId: req.params.locationId,
        locationName: 'Here', onHand: here.onHand, targetQty: rule.targetQty, minQty: rule.minQty,
      });
    }
    return networkRows;
  });
  const overstock = buildOverstockRecommendations(overstockRows, req.params.locationId, networkIncoming).filter((row) => !dismissedTypes.has(`OVERSTOCK:${row.itemId}`));

  return res.json({
    intelligence: {
      generatedAt: new Date().toISOString(), executiveSummary, recommendations, anomalies,
      lotBlocks, expiryActions, overstock,
    },
  });
});

// Dismiss half of the Action Center's "accept/edit/dismiss with an audit
// trail" (blueprint §17.1) - accept already has one via the real
// Transfer/PurchaseOrder record it creates. type REPLENISHMENT dismisses
// by itemId; type ANOMALY dismisses one specific countId (a fresh variance
// on the same item should still surface). type REORDER_SUGGESTION dismisses
// a reorder-rule suggestion (audit O-1) by itemId - its own accept is
// POST /reorder-rules/suggestions/:itemId/accept in catalog-procurement.ts.
router.post('/intelligence/:locationId/dismiss', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Intelligence insights require Admin or Auditor access.' });
  if (!canAccessLocation(req, req.params.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const type = ['ANOMALY', 'REPLENISHMENT', 'LOT_BLOCK', 'EXPIRY', 'OVERSTOCK', 'REORDER_SUGGESTION'].includes(req.body.type) ? req.body.type : null;
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  const countId = typeof req.body.countId === 'string' ? req.body.countId : null;
  if (!type || !itemId || (type === 'ANOMALY' && !countId)) {
    return res.status(400).json({ message: 'type, itemId, and countId for ANOMALY are required.' });
  }
  try {
    const dismissal = await prisma.intelligenceDismissal.create({
      data: { locationId: req.params.locationId, itemId, type, countId, reason: req.body.reason || null, dismissedById: req.user!.id },
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'INTELLIGENCE_RECOMMENDATION_DISMISSED',
      entityType: 'IntelligenceDismissal', entityId: dismissal.id,
      metadata: { locationId: req.params.locationId, itemId, type, countId, reason: req.body.reason ?? undefined },
    }));
    return res.status(201).json({ dismissal });
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'Intelligence dismissals are not available on this database yet.' });
  }
});

export default router;
