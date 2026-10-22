// OMS orders + ATP routes for operations-extension (Phase 4):
// extracted verbatim from operations-extension.ts; the composer
// mounts this router at the cluster's original position.
import { decimalsToNumbers } from '../lib/decimal-json.js';
import { type Request, type Response, Router } from 'express';
import { prisma } from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { listLocations } from '../lib/repository.js';
import { createOrderWithReservation, fulfillOrder, cancelOrder, expireStaleReservations, retryBackorderedOrders, OrderShortageError, InsufficientStockError as OrderInsufficientStockError, listMemoryOrders } from '../lib/orders.js';
import { verifyPackScan } from '../lib/pack-verification.js';
import { getCarrierAdapter } from '../lib/carrier-adapter.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { canAccessLocation, requireAdmin, requirePacker } from './opext-shared.js';

const router = Router();

// ============================================================================
// OMS ORDERS + ATP (blueprint Module G / section 13.3) - P7 starter
// ============================================================================

router.get('/orders', async (req, res) => {
  if (!databaseEnabled) {
    const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
    const orders = listMemoryOrders().filter((order) =>
      !locationId || order.fulfillmentLocationId === locationId || order.lines.some((line) => line.fulfillmentLocationId === locationId),
    );
    return res.json({ orders });
  }
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  await expireStaleReservations(companyId);
  await retryBackorderedOrders(companyId);
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const scope = locationId
    ? { fulfillmentLocationId: locationId }
    : ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)
      ? {}
      : { fulfillmentLocationId: { in: req.user!.locationIds ?? [] } };
  const orders = await prisma.order.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, ...scope, ...(status ? { status } : {}) },
    include: {
      lines: { include: { item: { select: { id: true, code: true, name: true } }, lot: { select: { id: true, lotNo: true } } } },
      fulfillmentLocation: { select: { id: true, code: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }).catch(() => []);
  return res.json({ orders: decimalsToNumbers(orders) });
});

router.post('/orders', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const channel = typeof req.body.channel === 'string' ? req.body.channel.trim() : '';
  const fulfillmentLocationId = typeof req.body.fulfillmentLocationId === 'string' && req.body.fulfillmentLocationId ? req.body.fulfillmentLocationId : null;
  const lines: Array<{ itemId: string; quantity: number; minRslPercent?: number }> = Array.isArray(req.body.lines)
    ? req.body.lines.map((line: any) => ({ itemId: String(line.itemId ?? ''), quantity: Number(line.quantity), ...(Number(line.minRslPercent) > 0 && Number(line.minRslPercent) <= 100 ? { minRslPercent: Number(line.minRslPercent) } : {}) })).filter((line: any) => line.itemId && Number.isFinite(line.quantity) && line.quantity > 0)
    : [];
  if (!channel || !lines.length) {
    return res.status(400).json({ message: 'channel and at least one positive-quantity line are required.' });
  }
  if (fulfillmentLocationId && !canAccessLocation(req, fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  try {
    // Blueprint §13.3 routing: no location was specified, so route across
    // every active location rather than requiring the caller to already
    // know which one can fulfil it.
    const candidateLocations = fulfillmentLocationId
      ? undefined
      : await (async () => {
          if (!databaseEnabled) {
            return listLocations().map((location) => ({
              locationId: location.id,
              locationName: location.name,
              locationType: location.type,
            }));
          }
          const locations = await prisma.location.findMany({
            where: { status: 'ACTIVE', companyId: req.companyId ?? DEFAULT_COMPANY_ID },
            select: { id: true, name: true, type: true, latitude: true, longitude: true, deliverySlaHours: true, shippingCostPerKm: true },
          });
          let openOrders: Array<{ fulfillmentLocationId: string; count: number }> = [];
          try {
            const grouped = await prisma.order.groupBy({
              by: ['fulfillmentLocationId'],
              where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, status: { in: ['RESERVED', 'BACKORDERED'] } },
              _count: { _all: true },
            });
            openOrders = grouped.map((row) => ({ fulfillmentLocationId: row.fulfillmentLocationId, count: row._count._all }));
          } catch {
            openOrders = [];
          }
          const workload = new Map(openOrders.map((row) => [row.fulfillmentLocationId, row.count] as const));
          return locations.map((location) => ({
            locationId: location.id,
            locationName: location.name,
            locationType: location.type,
            latitude: location.latitude,
            longitude: location.longitude,
            deliverySlaHours: location.deliverySlaHours,
            shippingCostPerKm: location.shippingCostPerKm == null ? null : Number(location.shippingCostPerKm),
            openOrderCount: workload.get(location.id) ?? 0,
          }));
        })();
    const reservationTtlMinutes = Number.isFinite(Number(req.body.reservationTtlMinutes)) && Number(req.body.reservationTtlMinutes) > 0
      ? Number(req.body.reservationTtlMinutes) : undefined;
    const order = await createOrderWithReservation({
      channel, fulfillmentLocationId, candidateLocations, lines,
      externalReference: req.body.externalReference || null,
      customerName: req.body.customerName || null,
      notes: req.body.notes || null,
      createdById: req.user!.id,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      reservationTtlMinutes,
      allowBackorder: Boolean(req.body.allowBackorder),
      allowSplit: req.body.allowSplit !== false,
      customerLatitude: Number.isFinite(Number(req.body.customerLatitude)) ? Number(req.body.customerLatitude) : null,
      customerLongitude: Number.isFinite(Number(req.body.customerLongitude)) ? Number(req.body.customerLongitude) : null,
    });
    return res.status(order.duplicate ? 200 : 201).json({ order, duplicate: Boolean(order.duplicate) });
  } catch (error) {
    if (error instanceof OrderShortageError) return res.status(409).json({ message: error.message, shortages: error.shortages });
    if (error instanceof OrderInsufficientStockError) return res.status(409).json({ message: error.message });
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to create order.' });
  }
});

router.post('/orders/:id/fulfill', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const order = await fulfillOrder(req.companyId ?? DEFAULT_COMPANY_ID, req.params.id, req.user!.id);
    return res.json({ order: decimalsToNumbers(order) });
  } catch (error) {
    if (error instanceof Error && error.message === 'Order was not found.') return res.status(404).json({ message: error.message });
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to fulfill order.' });
  }
});

router.post('/orders/:id/cancel', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const order = await cancelOrder(req.companyId ?? DEFAULT_COMPANY_ID, req.params.id, req.user!.id);
    return res.json({ order: decimalsToNumbers(order) });
  } catch (error) {
    if (error instanceof Error && error.message === 'Order was not found.') return res.status(404).json({ message: error.message });
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to cancel order.' });
  }
});

async function packVerificationFor(companyId: string, orderId: string, session: { id: string }) {
  const [order, packedLines] = await Promise.all([
    prisma.order.findFirst({ where: { id: orderId, companyId }, include: { lines: true } }),
    prisma.packedLine.findMany({ where: { packSessionId: session.id } }),
  ]);
  if (!order) return null;
  const expected = order.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: Number(line.requestedQty) }));
  const scanned = packedLines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, quantity: Number(line.quantity) }));
  return verifyPackScan(expected, scanned);
}

router.post('/orders/:id/pack/start', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  let session = await prisma.packSession.findFirst({ where: { orderId: order.id, status: 'IN_PROGRESS' } });
  if (!session) {
    session = await prisma.packSession.create({ data: { orderId: order.id, packedById: req.user!.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  }
  const verification = await packVerificationFor(order.companyId, order.id, session);
  return res.status(201).json({ session, verification });
});

router.get('/orders/:id/pack', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const session = await prisma.packSession.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
  if (!session) return res.json({ session: null, verification: null });
  const verification = await packVerificationFor(order.companyId, order.id, session);
  return res.json({ session, verification });
});

router.post('/orders/:id/pack/scan', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  const quantity = Number(req.body.quantity ?? 1);
  if (!itemId || !Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ message: 'itemId and a positive quantity are required.' });
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const session = await prisma.packSession.findFirst({ where: { orderId: order.id, status: 'IN_PROGRESS' } });
  if (!session) return res.status(409).json({ message: 'Start a pack session before scanning items.' });
  await prisma.packedLine.create({
    data: { packSessionId: session.id, itemId, lotId: typeof req.body.lotId === 'string' ? req.body.lotId : null, quantity, scannedById: req.user!.id },
  });
  const verification = await packVerificationFor(order.companyId, order.id, session);
  return res.status(201).json({ session, verification });
});

router.post('/orders/:id/pack/seal', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const session = await prisma.packSession.findFirst({ where: { orderId: order.id, status: 'IN_PROGRESS' } });
  if (!session) return res.status(409).json({ message: 'No pack session is in progress for this order.' });
  const verification = await packVerificationFor(order.companyId, order.id, session);
  if (!verification?.readyToSeal) {
    return res.status(409).json({ message: 'Every order line must be scanned exactly before sealing.', verification });
  }
  const sealed = await prisma.packSession.update({
    where: { id: session.id },
    data: {
      status: 'SEALED',
      sealedAt: new Date(),
      cartonCount: req.body.cartonCount !== undefined ? Number(req.body.cartonCount) : null,
      weightKg: req.body.weightKg !== undefined ? Number(req.body.weightKg) : null,
      lengthCm: req.body.lengthCm !== undefined ? Number(req.body.lengthCm) : null,
      widthCm: req.body.widthCm !== undefined ? Number(req.body.widthCm) : null,
      heightCm: req.body.heightCm !== undefined ? Number(req.body.heightCm) : null,
    },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'ORDER_PACK_SEALED',
    entityType: 'PackSession', entityId: sealed.id,
    metadata: { orderId: order.id, cartonCount: sealed.cartonCount, weightKg: sealed.weightKg },
  }));
  return res.json({ session: sealed, verification });
});

router.post('/orders/:id/ship', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const session = await prisma.packSession.findFirst({ where: { orderId: order.id, status: 'SEALED' }, orderBy: { sealedAt: 'desc' } });
  if (!session) return res.status(409).json({ message: 'Seal a pack session before shipping this order.' });

  const provider = typeof req.body.provider === 'string' && req.body.provider ? req.body.provider : 'local';
  let adapter;
  try {
    adapter = getCarrierAdapter(provider);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unknown carrier provider.' });
  }

  try {
    const result = await adapter.createShipment({
      orderReference: order.externalReference || order.id,
      originPincode: typeof req.body.originPincode === 'string' ? req.body.originPincode : '',
      destinationPincode: typeof req.body.destinationPincode === 'string' ? req.body.destinationPincode : '',
      weightKg: session.weightKg ?? 0,
      lengthCm: session.lengthCm, widthCm: session.widthCm, heightCm: session.heightCm,
    });
    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id, packSessionId: session.id, carrierProvider: adapter.provider,
        awbNumber: result.awbNumber, serviceCode: result.serviceCode, labelUrl: result.labelUrl, manifestId: result.manifestId,
        weightKg: session.weightKg, createdById: req.user!.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      },
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'ORDER_SHIPPED',
      entityType: 'Shipment', entityId: shipment.id,
      metadata: { orderId: order.id, awbNumber: shipment.awbNumber, carrierProvider: shipment.carrierProvider },
    }));
    return res.status(201).json({ shipment });
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'Unable to book this shipment.' });
  }
});

router.get('/orders/:id/shipment', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const shipment = await prisma.shipment.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
  if (!shipment) return res.json({ shipment: null, tracking: null });
  const adapter = getCarrierAdapter(shipment.carrierProvider);
  const tracking = await adapter.trackShipment(shipment.awbNumber).catch(() => null);
  return res.json({ shipment, tracking });
});

router.post('/shipments/:awb/cancel', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const shipment = await prisma.shipment.findFirst({ where: { awbNumber: req.params.awb, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!shipment) return res.status(404).json({ message: 'Shipment not found.' });
  if (!canAccessLocation(req, (await prisma.order.findFirst({ where: { id: shipment.orderId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } }))?.fulfillmentLocationId ?? '')) {
    return res.status(403).json({ message: 'Location access denied.' });
  }
  try {
    const adapter = getCarrierAdapter(shipment.carrierProvider);
    await adapter.cancelShipment(shipment.awbNumber);
    const updated = await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'CANCELLED' } });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'ORDER_SHIPMENT_CANCELLED',
      entityType: 'Shipment', entityId: shipment.id, metadata: { awbNumber: shipment.awbNumber },
    }));
    return res.json({ shipment: updated });
  } catch (error) {
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to cancel this shipment.' });
  }
});

export default router;
