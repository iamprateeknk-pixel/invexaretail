// Expiry-operations routes for operations-extension (Phase 4):
// extracted verbatim from operations-extension.ts; the composer
// mounts this router at the cluster's original registration position.
import { decimalsToNumbers } from '../lib/decimal-json.js';
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { daysUntilExpiry, expirySeverity, recommendedExpiryAction } from '../lib/expiry-alerts.js';
import { buildExpiryBoard, emptyExpiryBoard } from '../lib/expiry-board.js';
import { ExpiryWriteOffError, buildLocationExpiryBoard, listLocationExpiryAlerts, writeOffExpiryLot } from '../lib/expiry-lifecycle.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { adjustStockLedger } from '../lib/repository.js';
import { maybeEmitStockLow } from '../lib/webhook-dispatcher.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { postInventoryMovementInTransaction } from '../lib/inventory-posting-service.js';
import { tenantContextOf, canAccessLocation, expiryAlertId } from './opext-shared.js';

const router = Router();

router.get('/expiry-alerts', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) {
    return res.json({ alerts: listLocationExpiryAlerts(locationId) });
  }
  const ledger = await prisma.stockLedger.findMany({
    where: { locationId, onHand: { gt: 0 }, lot: { expiryDate: { not: null } } },
    include: {
      lot: { select: { lotNo: true, status: true, expiryDate: true } },
      item: { select: { code: true, name: true } },
    },
    orderBy: { onHand: 'desc' },
  });
  const alerts = ledger
    .filter((row) => row.lot.expiryDate)
    .map((row) => {
      const days = daysUntilExpiry(row.lot.expiryDate!);
      return {
        id: `expiry-${createHash('sha1').update(`${row.itemId}|${row.lotId}|${row.locationId}`).digest('hex').slice(0, 24)}`,
        itemId: row.itemId,
        lotId: row.lotId,
        locationId: row.locationId,
        quantity: Number(row.onHand),
        expiryDate: row.lot.expiryDate,
        daysUntilExpiry: days,
        status: 'ACTIVE',
        recommendedAction: recommendedExpiryAction(days),
        item: row.item,
        lot: { lotNo: row.lot.lotNo, status: row.lot.status },
        severity: expirySeverity(days),
      };
    })
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  return res.json({ alerts });
});

router.get('/expiry-board', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) {
    return res.json({ board: buildLocationExpiryBoard(locationId) });
  }
  const ledger = await prisma.stockLedger.findMany({
    where: { locationId, onHand: { gt: 0 } },
    include: {
      lot: { select: { id: true, lotNo: true, status: true, expiryDate: true, attributes: true } },
      item: { select: { id: true, code: true, name: true, category: true, subcategory: true, company: true, unit: true } },
    },
  });
  const board = ledger.length
    ? buildExpiryBoard({
        items: ledger.map((row) => row.item),
        lots: ledger.map((row) => ({
          id: row.lot.id,
          lotNo: row.lot.lotNo,
          expiryDate: row.lot.expiryDate,
          status: row.lot.status,
          attributes: (row.lot.attributes as Record<string, unknown> | null) ?? null,
        })),
        stock: ledger.map((row) => ({
          itemId: row.itemId,
          lotId: row.lotId,
          locationId: row.locationId,
          quantity: Number(row.onHand),
        })),
      })
    : emptyExpiryBoard();
  return res.json({ board });
});

router.post('/expiry-write-off', async (req, res) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only the Main Admin can post an expiry write-off.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5) return res.status(400).json({ message: 'A write-off reason of at least 5 characters is required.' });
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  const lotId = typeof req.body.lotId === 'string' ? req.body.lotId : '';
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : '';
  if (!itemId || !lotId || !locationId) return res.status(400).json({ message: 'itemId, lotId and locationId are required.' });
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const requestedQty = Number(req.body.quantity);
  if (!databaseEnabled) {
    try {
      const result = writeOffExpiryLot({
        itemId, lotId, locationId, quantity: requestedQty, reason, actorId: req.user!.id, role: req.user!.role,
      });
      await persistAudit(recordAudit({
        actorId: req.user!.id, actorRole: req.user!.role, action: 'EXPIRY_STOCK_WRITTEN_OFF',
        entityType: 'ExpiryAlert', entityId: result.alertId,
        metadata: { quantity: result.quantity, beforeBalance: result.beforeBalance, afterBalance: result.afterBalance, movementId: result.movementId, reason, itemId, lotId, locationId },
      }));
      maybeEmitStockLow(itemId, locationId, result.beforeBalance);
      return res.json({ success: true, result });
    } catch (error) {
      const status = error instanceof ExpiryWriteOffError ? error.status : 400;
      return res.status(status).json({ message: error instanceof Error ? error.message : 'Expiry write-off failed.' });
    }
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const [ledger, lot] = await Promise.all([
        tx.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, itemId, lotId, locationId } } }),
        tx.lot.findUnique({ where: { id: lotId } }),
      ]);
      if (!lot) throw new Error('Lot not found.');
      const quantity = Number.isFinite(requestedQty) && requestedQty > 0 ? requestedQty : Number(ledger?.onHand ?? 0);
      if (!ledger || quantity <= 0 || quantity > Number(ledger.onHand)) throw new Error('Write-off quantity exceeds current lot stock.');
      const days = lot.expiryDate ? daysUntilExpiry(lot.expiryDate) : 0;
      const alertId = expiryAlertId(itemId, lotId, locationId);
      await tx.expiryAlert.upsert({
        where: { id: alertId },
        create: {
          id: alertId, itemId, lotId, locationId,
          quantity: Number(ledger.onHand), expiryDate: lot.expiryDate ?? new Date(), daysUntilExpiry: days,
          status: 'ACTIVE', recommendedAction: recommendedExpiryAction(days),
          metadata: { severity: lot.expiryDate ? expirySeverity(days) : 'MISSING' },
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        },
        update: {
          quantity: Number(ledger.onHand), expiryDate: lot.expiryDate ?? new Date(), daysUntilExpiry: days,
          status: 'ACTIVE', resolvedAt: null,
          recommendedAction: recommendedExpiryAction(days),
        },
      });
      const claimed = await tx.expiryAlert.updateMany({
        where: { id: alertId, companyId: req.companyId ?? DEFAULT_COMPANY_ID, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        data: { status: 'RESOLVED_BY_WRITE_OFF', resolvedAt: new Date(), quantity: Math.max(0, Number(ledger.onHand) - quantity) },
      });
      if (claimed.count !== 1) throw new Error('Expiry alert was already processed.');
      const afterBalance = Number(ledger.onHand) - quantity;
      // Canonical posting inside this transaction (journal + ledger + audit + outbox).
      // The key carries the ledger version so a later, legitimate write-off of the same
      // lot (the alert id is deterministic per item/lot/location) is a new movement.
      const { movement } = await postInventoryMovementInTransaction(tx, {
        tenant: tenantContextOf(req), itemId, lotId, locationId,
        movementType: 'EXPIRY_WRITE_OFF', qtyDelta: -quantity,
        idempotencyKey: `expiry-writeoff:${alertId}:${ledger.version}`,
        reason, sourceDocument: alertId, correlationId: alertId,
        metadata: { expiryDate: lot.expiryDate?.toISOString() ?? null, alertId },
      });
      await tx.auditLog.create({ data: {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'EXPIRY_STOCK_WRITTEN_OFF',
        entityType: 'ExpiryAlert', entityId: alertId,
        metadata: { quantity, beforeBalance: Number(ledger.onHand), afterBalance, movementId: movement.id, reason, itemId, lotId, locationId },
      } });
      return { alertId, movementId: movement.id, quantity, beforeBalance: Number(ledger.onHand), afterBalance };
    });
    try {
      adjustStockLedger(itemId, lotId, locationId, -result.quantity);
    } catch {
      // Hydrated ledger may not contain this row in isolated API use.
    }
    maybeEmitStockLow(itemId, locationId, result.beforeBalance);
    return res.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Expiry write-off failed.';
    return res.status(message.includes('not found') ? 404 : message.includes('already') ? 409 : 400).json({ message });
  }
});

router.patch('/expiry-alerts/:id/status', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const status = String(req.body.status ?? '');
  if (!['ACKNOWLEDGED', 'RESOLVED'].includes(status)) return res.status(400).json({ message: 'Status must be ACKNOWLEDGED or RESOLVED.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (status === 'RESOLVED' && reason.length < 5) return res.status(400).json({ message: 'A resolution reason of at least 5 characters is required.' });
  const current = await prisma.expiryAlert.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!current) return res.status(404).json({ message: 'Expiry alert not found.' });
  if (!canAccessLocation(req, current.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const alert = await prisma.expiryAlert.update({
    where: { id: current.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    data: {
      status: status as any,
      acknowledgedAt: status === 'ACKNOWLEDGED' ? new Date() : current.acknowledgedAt,
      resolvedAt: status === 'RESOLVED' ? new Date() : null,
      metadata: { ...(current.metadata && typeof current.metadata === 'object' ? current.metadata as object : {}), statusReason: reason || undefined, statusActorId: req.user!.id },
    },
  });
  await prisma.auditLog.create({ data: {
    actorId: req.user!.id, actorRole: req.user!.role, action: `EXPIRY_ALERT_${status}`,
    entityType: 'ExpiryAlert', entityId: alert.id, metadata: { reason, locationId: alert.locationId },
  } });
  return res.json({ alert: decimalsToNumbers(alert) });
});

router.post('/expiry-alerts/:id/write-off', async (req, res) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only the Main Admin can post an expiry write-off.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5) return res.status(400).json({ message: 'A write-off reason of at least 5 characters is required.' });
  const requestedQty = Number(req.body.quantity);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const alert = await tx.expiryAlert.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
      if (!alert) throw new Error('Expiry alert not found.');
      if (!['ACTIVE', 'ACKNOWLEDGED'].includes(String(alert.status))) throw new Error('Expiry alert is already resolved.');
      if (!canAccessLocation(req, alert.locationId)) throw new Error('Location access denied.');
      const ledger = await tx.stockLedger.findUnique({
        where: { companyId_itemId_lotId_locationId: { companyId: alert.companyId, itemId: alert.itemId, lotId: alert.lotId, locationId: alert.locationId } },
      });
      const quantity = Number.isFinite(requestedQty) && requestedQty > 0 ? requestedQty : Number(alert.quantity);
      if (!ledger || quantity <= 0 || quantity > Number(ledger.onHand)) throw new Error('Write-off quantity exceeds current lot stock.');
      const claimed = await tx.expiryAlert.updateMany({
        where: { id: alert.id, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        data: { status: 'RESOLVED_BY_WRITE_OFF', resolvedAt: new Date(), quantity: Math.max(0, Number(alert.quantity) - quantity) },
      });
      if (claimed.count !== 1) throw new Error('Expiry alert was already processed.');
      const afterBalance = Number(ledger.onHand) - quantity;
      const { movement } = await postInventoryMovementInTransaction(tx, {
        tenant: tenantContextOf(req), itemId: alert.itemId, lotId: alert.lotId, locationId: alert.locationId,
        movementType: 'EXPIRY_WRITE_OFF', qtyDelta: -quantity,
        idempotencyKey: `expiry-writeoff:${alert.id}:${ledger.version}`,
        reason, sourceDocument: alert.id, correlationId: alert.id,
        metadata: { expiryDate: alert.expiryDate.toISOString(), alertId: alert.id },
      });
      await tx.auditLog.create({ data: {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'EXPIRY_STOCK_WRITTEN_OFF',
        entityType: 'ExpiryAlert', entityId: alert.id,
        metadata: { quantity, beforeBalance: Number(ledger.onHand), afterBalance, movementId: movement.id, reason },
      } });
      return { alertId: alert.id, movementId: movement.id, quantity, beforeBalance: Number(ledger.onHand), afterBalance };
    });
    return res.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Expiry write-off failed.';
    return res.status(message.includes('not found') ? 404 : message.includes('Access denied') ? 403 : message.includes('already') ? 409 : 400).json({ message });
  }
});

export default router;
