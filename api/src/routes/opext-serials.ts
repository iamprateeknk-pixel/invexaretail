// Serial-tracking routes for operations-extension (Phase 4): extracted
// verbatim from operations-extension.ts; the composer mounts this router
// at the cluster's original registration position.
import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { buildRecallTrace, planSerialMovement, type SerialStatus } from '../lib/serial-tracking.js';
import { canAccessLocation } from './opext-shared.js';

const router = Router();

// ============================================================================
// Serial tracking (blueprint P3 "Traceability 3.0")
// ============================================================================

router.post('/items/:itemId/serials', async (req, res) => {
  const itemId = req.params.itemId;
  const serial = typeof req.body.serial === 'string' ? req.body.serial.trim() : '';
  if (!serial) return res.status(400).json({ message: 'Serial number is required.' });
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : null;
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const item = await prisma.item.findFirst({ where: { id: itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!item) return res.status(404).json({ message: 'Item was not found.' });
  const movement = planSerialMovement({
    currentStatus: 'IN_STOCK',
    toStatus: 'IN_STOCK',
    movementType: 'RECEIVE',
    toLocationId: locationId,
    reference: typeof req.body.reference === 'string' ? req.body.reference : null,
    actorId: req.user!.id,
  });
  try {
    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.serialNumber.create({
        data: {
          itemId,
          lotId: typeof req.body.lotId === 'string' ? req.body.lotId : null,
          serial,
          status: 'IN_STOCK',
          currentLocationId: locationId,
          warrantyEnd: req.body.warrantyEnd ? new Date(req.body.warrantyEnd) : null,
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        },
      });
      await tx.serialMovement.create({ data: { serialNumberId: record.id, ...movement } });
      return record;
    });
    return res.status(201).json({ serial: created });
  } catch (error) {
    return res.status(409).json({ message: error instanceof Error && error.message.includes('Unique') ? 'This serial is already registered for this item.' : 'Unable to register serial.' });
  }
});

router.get('/items/:itemId/serials', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const serials = await prisma.serialNumber.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, itemId: req.params.itemId, ...(status ? { status } : {}) },
    orderBy: { receivedAt: 'desc' },
  });
  return res.json({ serials });
});

router.get('/serials/:serial', async (req, res) => {
  const record = await prisma.serialNumber.findFirst({ where: { serial: req.params.serial, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!record) return res.status(404).json({ message: 'Serial was not found.' });
  const movements = await prisma.serialMovement.findMany({ where: { serialNumberId: record.id }, orderBy: { createdAt: 'asc' } });
  return res.json({ serial: record, trace: buildRecallTrace(movements) });
});

router.post('/serials/:serial/move', async (req, res) => {
  const record = await prisma.serialNumber.findFirst({ where: { serial: req.params.serial, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!record) return res.status(404).json({ message: 'Serial was not found.' });
  const toLocationId = typeof req.body.toLocationId === 'string' ? req.body.toLocationId : null;
  if (toLocationId && !canAccessLocation(req, toLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  let movement;
  try {
    movement = planSerialMovement({
      currentStatus: record.status as SerialStatus,
      toStatus: req.body.toStatus,
      movementType: req.body.movementType,
      fromLocationId: record.currentLocationId,
      toLocationId,
      reference: typeof req.body.reference === 'string' ? req.body.reference : null,
      actorId: req.user!.id,
    });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid serial transition.' });
  }
  const [, updated] = await prisma.$transaction([
    prisma.serialMovement.create({ data: { serialNumberId: record.id, ...movement } }),
    prisma.serialNumber.update({
      where: { id: record.id },
      data: {
        status: movement.toStatus,
        currentLocationId: toLocationId ?? record.currentLocationId,
        soldAt: movement.toStatus === 'SOLD' ? new Date() : record.soldAt,
        returnState: movement.toStatus === 'RETURNED' ? (req.body.returnState ?? record.returnState) : record.returnState,
      },
    }),
  ]);
  return res.json({ serial: updated });
});

export default router;
