import { decimalsToNumbers } from '../lib/decimal-json.js';
import { type Request, type Response, Router } from 'express';
import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { recordAudit } from '../lib/audit.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { adjustQuarantineLedger, adjustStockLedger, ensureLotRecord, listItems, listLocations } from '../lib/repository.js';
import { createExceptionCase } from '../lib/exceptions.js';
import { createOrderWithReservation, fulfillOrder, cancelOrder, expireStaleReservations, retryBackorderedOrders, retryBackorderAllocation, OrderShortageError, OrderInsufficientStockError, listMemoryOrders } from '../lib/orders.js';
import { listMemoryQcTemplates, listMemoryQcInspections, findTemplateForCategory } from '../lib/qc-inspection.js';
import { verifyPackScan } from '../lib/pack-verification.js';
import { getCarrierAdapter } from '../lib/carrier-adapter.js';
import { canCloseReturn, isPendingDisposition, nextReturnStatus, parseRefundDecision, planReturnLine, validateReturnLines, type ReturnAction } from '../lib/returns-rma.js';
import { transitionReturnStatus } from '../lib/domain-policies.js';
import { verdictForLine, type InspectionLike } from '../lib/qc-gate.js';
import { createConnector, findConnector, listConnectors, mapMarketplaceOrder, markConnectorIngested, validateNormalizedOrder, type ConnectorPlatform } from '../lib/connectors.js';
import { findPlan, listTenants, provisionTenant, SAAS_PLANS, tenantAllows } from '../lib/saas.js';
import { mobileHomeForRole } from '../lib/mobile-role.js';
import { createCompany, createEnhancedUser, findUserByEmail } from '../lib/enterprise-repository.js';
import { hashPassword, validatePassword } from '../lib/otp-auth.js';
import { isKnownDefaultPassword } from '../lib/production-guard.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { postInventoryMovementInTransaction } from '../lib/inventory-posting-service.js';
import { tenantContextOf, canAccessLocation, requireAdmin, requirePlatformOperator } from './opext-shared.js';
import collabRouter from './opext-collab.ts';
import serialsRouter from './opext-serials.ts';
import webhooksRouter from './opext-webhooks.ts';
import { webhookDeliveriesRouter } from './opext-webhooks.ts';
import rulesRouter from './opext-rules.ts';
import expiryRouter from './opext-expiry.ts';
import binsRouter from './opext-bins.ts';
import { binStockRouter } from './opext-bins.ts';
import qcExceptionsRouter from './opext-qc-exceptions.ts';
import jobsRouter from './opext-jobs.ts';
import intelligenceRouter from './opext-intelligence.ts';
import { createPutawayTask } from '../lib/putaway.js';

const router = Router();

router.use(extractToken, requireAuth, enforcePermissionOverrides, respondWhenMemoryUnavailable);

router.use(jobsRouter);

router.use(collabRouter);

router.use(expiryRouter);

router.use(intelligenceRouter);

router.use(webhooksRouter);

router.use(binsRouter);

router.use(serialsRouter);

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

function requirePacker(req: Request, res: Response): boolean {
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(req.user!.role)) {
    res.status(403).json({ message: 'Admin or Warehouse Picker access required.' });
    return false;
  }
  return true;
}

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

// Blueprint "Returns/RMA: a formal customer-return/RMA/inspection flow" -
// additive on top of Order/OrderLine, same as pack/ship above. Status
// moves through lib/returns-rma.ts's state machine; only a RECEIVE action
// on a RESTOCK-disposition line ever posts stock back onto the ledger.
router.post('/orders/:id/returns', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });

  const requestedLines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const existingReturns = await prisma.returnLine.findMany({
    where: { orderLine: { orderId: order.id } },
    select: { orderLineId: true, quantity: true },
  });
  const alreadyReturnedByLine = new Map<string, number>();
  for (const line of existingReturns) {
    alreadyReturnedByLine.set(line.orderLineId, (alreadyReturnedByLine.get(line.orderLineId) ?? 0) + Number(line.quantity));
  }
  const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
  const validationInput = requestedLines
    .map((line: { orderLineId?: string; quantity?: number }) => {
      const orderLine = orderLinesById.get(String(line.orderLineId));
      return {
        orderLineId: String(line.orderLineId || ''),
        quantity: Number(line.quantity),
        fulfilledQty: orderLine?.fulfilledQty == null ? 0 : Number(orderLine.fulfilledQty),
        alreadyReturnedQty: alreadyReturnedByLine.get(String(line.orderLineId)) ?? 0,
      };
    })
    .filter((line) => orderLinesById.has(line.orderLineId));
  const validation = validateReturnLines(validationInput);
  if (!validation.ok) return res.status(400).json({ message: 'Invalid return lines.', errors: validation.errors });

  const returnRequest = await prisma.returnRequest.create({
    data: {
      orderId: order.id,
      reason: typeof req.body.reason === 'string' ? req.body.reason : null,
      createdById: req.user!.id,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      lines: {
        create: validationInput.map((line) => ({
          orderLineId: line.orderLineId,
          itemId: orderLinesById.get(line.orderLineId)!.itemId,
          quantity: line.quantity,
        })),
      },
    },
    include: { lines: true },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'RETURN_REQUESTED',
    entityType: 'ReturnRequest', entityId: returnRequest.id, metadata: { orderId: order.id, lines: returnRequest.lines.length },
  }));
  return res.status(201).json({ returnRequest });
});

router.get('/orders/:id/returns', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const returnRequests = await prisma.returnRequest.findMany({ where: { orderId: order.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true }, orderBy: { createdAt: 'desc' } });
  return res.json({ returnRequests });
});

// Blueprint v4 §24: what QC says about a returned line, and whether QC applies.
async function returnQcContext(companyId: string, returnRequestId: string, itemIds: string[]) {
  const { listMemoryQcTemplates, listMemoryQcInspections } = await import('../lib/qc-inspection.js');
  const templates: Array<{ id: string; category: string | null; active: boolean }> = databaseEnabled
    ? await prisma.qcChecklistTemplate.findMany({ where: { active: true, createdBy: { companyId } } }).catch(() => listMemoryQcTemplates().filter((row) => row.active))
    : listMemoryQcTemplates().filter((row) => row.active);
  const inspections: InspectionLike[] = databaseEnabled
    ? await prisma.qcInspection.findMany({ where: { sourceDocument: returnRequestId, inspectedBy: { companyId } } }).catch(() => [])
    : listMemoryQcInspections().filter((row) => row.sourceDocument === returnRequestId);
  const categories = new Map<string, string | null>();
  if (databaseEnabled && itemIds.length) {
    for (const row of await prisma.item.findMany({ where: { id: { in: itemIds }, companyId }, select: { id: true, category: true } })) categories.set(row.id, row.category ?? null);
  } else {
    for (const item of listItems()) categories.set(item.id, item.category ?? null);
  }
  return {
    qcRequired: (itemId: string) => findTemplateForCategory(templates, categories.get(itemId) ?? null) !== null,
    verdict: (itemId: string, lineId: string) => verdictForLine(inspections, { itemId, lineId }),
  };
}

async function returnLot(returnRequestId: string, itemId: string) {
  const lotNo = `RMA-${returnRequestId}`;
  const lot = await prisma.lot.upsert({
    where: { itemId_lotNo: { itemId, lotNo } },
    update: {},
    create: { itemId, lotNo, attributes: { source: 'return', returnRequestId } },
  });
  try {
    ensureLotRecord(itemId, lotNo, null, { source: 'return' }, lot.id);
  } catch {
    // Item may not be in the in-memory catalogue during isolated tests.
  }
  return lot;
}

router.patch('/returns/:id/status', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const returnRequest = await prisma.returnRequest.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true, order: true } });
  if (!returnRequest) return res.status(404).json({ message: 'Return request not found.' });
  if (!canAccessLocation(req, returnRequest.order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });

  const action = String(req.body.action || '') as ReturnAction;
  const nextStatus = nextReturnStatus(returnRequest.status as never, action);
  if (!nextStatus) return res.status(409).json({ message: `Cannot apply action ${action} to a return in status ${returnRequest.status}.` });

  const locationId = returnRequest.order.fulfillmentLocationId;
  if (action === 'CLOSE') {
    const closable = canCloseReturn(returnRequest.lines);
    if ('message' in closable) return res.status(409).json({ message: closable.message });
  }

  if (action === 'RECEIVE') {
    const dispositions = req.body.dispositions && typeof req.body.dispositions === 'object' ? req.body.dispositions as Record<string, string> : {};
    const qc = await returnQcContext(returnRequest.companyId, returnRequest.id, returnRequest.lines.map((line) => line.itemId));
    // Decide every line before touching stock, so one bad line cannot leave the return half-received.
    const plans = [];
    for (const line of returnRequest.lines) {
      const plan = planReturnLine({ requested: dispositions[line.id], qcRequired: qc.qcRequired(line.itemId), verdict: qc.verdict(line.itemId, line.id) });
      if ('message' in plan) return res.status(400).json({ message: plan.message, lineId: line.id });
      plans.push({ line, plan });
    }
    for (const { line, plan } of plans) {
      await prisma.returnLine.update({ where: { id: line.id }, data: { disposition: plan.disposition } });
      const lot = await returnLot(returnRequest.id, line.itemId);
      if (plan.action === 'RESTOCK') {
        await prisma.$transaction((tx) => postInventoryMovementInTransaction(tx, {
          tenant: tenantContextOf(req), itemId: line.itemId, lotId: lot.id, locationId,
          movementType: 'SALES_RETURN', qtyDelta: line.quantity,
          idempotencyKey: `return-restock:${returnRequest.id}:${line.id}`,
          reason: 'Customer return restocked after inspection', sourceDocument: returnRequest.id, sourceLineId: line.id, correlationId: returnRequest.orderId,
        }));
        adjustStockLedger(line.itemId, lot.id, locationId, line.quantity);
      } else if (plan.action === 'HOLD') {
        // Physically back in the building but not sellable: quarantine until a disposition is decided.
        await prisma.stockLedger.upsert({
          where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: lot.id, locationId } },
          update: { quarantine: { increment: line.quantity }, version: { increment: 1 } },
          create: { itemId: line.itemId, lotId: lot.id, locationId, onHand: 0, quarantine: line.quantity, version: 1 },
        });
        adjustQuarantineLedger(line.itemId, lot.id, locationId, line.quantity);
        void createExceptionCase({
          type: plan.disposition === 'QC_FAILED' ? 'QC_FAIL' : 'QUARANTINE',
          title: plan.disposition === 'QC_FAILED' ? 'Returned goods failed QC' : 'Returned goods awaiting inspection',
          description: plan.note ?? null,
          itemId: line.itemId, lotId: lot.id, locationId, quantity: line.quantity,
          sourceDocument: returnRequest.id, sourceLineId: line.id, reportedById: req.user!.id,
          companyId: returnRequest.companyId,
        });
      }
      await persistAudit(recordAudit({
        actorId: req.user!.id, actorRole: req.user!.role, action: 'RETURN_LINE_RECEIVED',
        entityType: 'ReturnRequest', entityId: returnRequest.id, metadata: { lineId: line.id, quantity: line.quantity, disposition: plan.disposition },
      }));
    }
  }

  const updated = await transitionReturnStatus({
    entityId: returnRequest.id,
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    action,
    actorId: req.user!.id,
    actorRole: req.user!.role,
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: `RETURN_${action}`,
    entityType: 'ReturnRequest', entityId: returnRequest.id, metadata: { orderId: returnRequest.orderId, status: nextStatus },
  }));
  return res.json({ returnRequest: updated });
});

// Decide a held line: restock (needs a passing QC where QC applies), scrap, or send back to the vendor.
router.post('/returns/:id/lines/:lineId/disposition', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const returnRequest = await prisma.returnRequest.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true, order: true } });
  if (!returnRequest) return res.status(404).json({ message: 'Return request not found.' });
  if (!canAccessLocation(req, returnRequest.order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (returnRequest.status !== 'RECEIVED') return res.status(409).json({ message: 'Only a received return can have its lines disposed.' });
  const line = returnRequest.lines.find((row) => row.id === req.params.lineId);
  if (!line) return res.status(404).json({ message: 'Return line was not found.' });
  if (!isPendingDisposition(line.disposition)) return res.status(409).json({ message: `This line was already dispositioned as ${line.disposition}.` });

  const qc = await returnQcContext(returnRequest.companyId, returnRequest.id, [line.itemId]);
  const plan = planReturnLine({ requested: String(req.body.disposition ?? ''), qcRequired: qc.qcRequired(line.itemId), verdict: qc.verdict(line.itemId, line.id) });
  if ('message' in plan) return res.status(400).json({ message: plan.message });
  if (plan.action === 'HOLD') return res.status(409).json({ message: plan.note ?? 'This line must stay in quarantine.' });

  const locationId = returnRequest.order.fulfillmentLocationId;
  const lot = await returnLot(returnRequest.id, line.itemId);
  const ledger = await prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: lot.id, locationId } } });
  if (!ledger || Number(ledger.quarantine) + 1e-8 < line.quantity) return res.status(409).json({ message: 'The quarantined quantity for this line was not found.' });
  const restock = plan.action === 'RESTOCK';
  await prisma.$transaction(async (tx) => {
    await tx.stockLedger.update({
      where: { id: ledger.id },
      data: {
        quarantine: { decrement: line.quantity },
        ...(plan.action === 'SCRAP' ? { damaged: { increment: line.quantity } } : {}),
        version: { increment: 1 },
      },
    });
    if (restock) {
      await postInventoryMovementInTransaction(tx, {
        tenant: tenantContextOf(req), itemId: line.itemId, lotId: lot.id, locationId,
        movementType: 'SALES_RETURN', qtyDelta: line.quantity,
        idempotencyKey: `return-disposition:${returnRequest.id}:${line.id}`,
        reason: `Return disposition: ${plan.disposition}`, sourceDocument: returnRequest.id, sourceLineId: line.id, correlationId: returnRequest.orderId,
      });
    } else {
      // Quarantine -> damaged/other is a bucket move, not an on-hand change: zero-delta journal row.
      await tx.stockMovement.create({
        data: {
          itemId: line.itemId, lotId: lot.id, locationId, movementType: plan.action === 'SCRAP' ? 'DAMAGE' : 'ADJUSTMENT',
          qtyDelta: 0, beforeBalance: ledger.onHand, afterBalance: ledger.onHand,
          sourceDocument: returnRequest.id, sourceLineId: line.id, actor: req.user!.id, timestamp: new Date(), correlationId: returnRequest.orderId,
          reason: `Return disposition: ${plan.disposition}`, metadata: { quarantineDelta: -line.quantity },
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        } as never,
      });
    }
  });
  adjustQuarantineLedger(line.itemId, lot.id, locationId, -line.quantity);
  if (restock) adjustStockLedger(line.itemId, lot.id, locationId, line.quantity);
  await prisma.returnLine.update({ where: { id: line.id }, data: { disposition: plan.disposition } });
  // The quarantine case opened at receipt is decided by this action.
  await prisma.exceptionCase.updateMany({
    where: { companyId: returnRequest.companyId, sourceDocument: returnRequest.id, sourceLineId: line.id, status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  }).catch(() => undefined);
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'RETURN_LINE_DISPOSED',
    entityType: 'ReturnRequest', entityId: returnRequest.id, metadata: { lineId: line.id, disposition: plan.disposition, quantity: line.quantity },
  }));
  const refreshed = await prisma.returnRequest.findFirst({ where: { id: returnRequest.id, companyId: returnRequest.companyId }, include: { lines: true } });
  return res.json({ returnRequest: refreshed });
});

// Blueprint v4 §24 "Refund status": a finance decision, recorded separately from the stock disposition.
router.patch('/returns/:id/refund', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const decision = parseRefundDecision(req.body.status);
  if (!decision) return res.status(400).json({ message: 'Refund status must be REFUNDED or DENIED.' });
  const returnRequest = await prisma.returnRequest.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!returnRequest) return res.status(404).json({ message: 'Return request not found.' });
  if (!['RECEIVED', 'CLOSED'].includes(returnRequest.status)) return res.status(409).json({ message: 'A refund can be decided once the goods have been received.' });
  const updated = await prisma.returnRequest.update({
    where: { id: returnRequest.id, companyId: returnRequest.companyId },
    data: { refundStatus: decision, refundNote: typeof req.body.note === 'string' ? req.body.note.slice(0, 2000) : null, refundedAt: new Date(), refundedById: req.user!.id },
  });
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: `RETURN_REFUND_${decision}`, entityType: 'ReturnRequest', entityId: returnRequest.id }));
  return res.json({ returnRequest: updated });
});

// Manual trigger for visibility/testing - GET /orders and every order
// mutation already sweep expired reservations lazily, so this is never
// required for correctness, only for an admin to force it on demand.
router.post('/orders/expire-reservations', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const expiredCount = await expireStaleReservations(req.companyId ?? DEFAULT_COMPANY_ID);
  return res.json({ expiredCount });
});

// Manual trigger for visibility/testing - GET /orders already retries
// every BACKORDERED order lazily, so this is never required for
// correctness either, only for an admin to force it on demand (e.g. right
// after receiving new stock, before the next order list happens to run).
router.post('/orders/retry-backorders', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const filledCount = await retryBackorderedOrders(req.companyId ?? DEFAULT_COMPANY_ID);
  return res.json({ filledCount });
});

router.post('/orders/:id/retry-backorder', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const order = await retryBackorderAllocation(req.companyId ?? DEFAULT_COMPANY_ID, req.params.id);
  if (!order) return res.status(404).json({ message: 'Order was not found.' });
  return res.json({ order });
});

router.use(rulesRouter);

router.use(qcExceptionsRouter);

router.use(binStockRouter);

router.get('/mobile/home', async (req, res) => {
  return res.json({ home: mobileHomeForRole(req.user!.role) });
});

router.get('/saas/plans', async (_req, res) => {
  return res.json({ plans: SAAS_PLANS });
});

router.get('/saas/tenants', async (req, res) => {
  if (!requirePlatformOperator(req, res)) return;
  return res.json({ tenants: listTenants(), entitlements: SAAS_PLANS });
});

router.post('/saas/onboard', async (req, res) => {
  if (!requirePlatformOperator(req, res)) return;
  try {
    const companyName = String(req.body.companyName ?? '').trim();
    const adminName = String(req.body.adminName ?? '').trim();
    const adminEmail = String(req.body.adminEmail ?? '').trim().toLowerCase();
    const planCode = String(req.body.planCode ?? 'starter');
    // No default password: a tenant admin created with a value that is public in the
    // repository can be taken over by anyone who knows the sign-in email.
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) return res.status(400).json({ message: passwordCheck.message ?? 'A strong temporary password is required.' });
    if (isKnownDefaultPassword(password)) return res.status(400).json({ message: 'That password is publicly known. Choose a different temporary password.' });
    const { tenant, subscription } = provisionTenant({ companyName, adminName, adminEmail, planCode });
    if (findUserByEmail(adminEmail)) {
      return res.status(409).json({ message: 'An account with that admin email already exists.', tenant, subscription });
    }
    const selectedPlan = findPlan(planCode);
    if (!selectedPlan) return res.status(400).json({ message: 'Unknown or inactive plan.' });
    const plan = planCode === 'enterprise' ? 'enterprise' : planCode === 'growth' ? 'pro' : 'free';
    const company = createCompany({
      name: companyName, email: adminEmail, plan, industry: 'retail',
    });
    const user = createEnhancedUser({
      companyId: tenant.id,
      email: adminEmail,
      name: adminName,
      role: 'ADMIN',
      branchIds: [],
      locationIds: [],
      passwordHash: hashPassword(password),
      status: 'active',
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'TENANT_PROVISIONED',
      entityType: 'Tenant', entityId: tenant.id,
      metadata: { planCode, adminEmail, companyId: company.id, userId: user.id },
    }));
    return res.status(201).json({ tenant, subscription, company, user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to provision tenant.' });
  }
});

router.get('/connectors', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const tenantId = req.user!.companyId ?? 'default-company';
  if (databaseEnabled) {
    const rows = await prisma.marketplaceConnector.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }).catch(() => []);
    return res.json({ connectors: rows.length ? rows : listConnectors(tenantId) });
  }
  return res.json({ connectors: listConnectors(tenantId) });
});

router.post('/connectors', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = String(req.body.name ?? '').trim();
  const platform = String(req.body.platform ?? '').toUpperCase() as ConnectorPlatform;
  if (!name || !['AMAZON', 'FLIPKART', 'WEBSITE', 'CUSTOM'].includes(platform)) {
    return res.status(400).json({ message: 'name and platform (AMAZON, FLIPKART, WEBSITE, CUSTOM) are required.' });
  }
  const tenantId = req.user!.companyId ?? 'default-company';
  const webhookSecret = String(req.body.webhookSecret ?? `whsec_${Math.random().toString(36).slice(2, 14)}`);
  const memory = createConnector({ name, platform, webhookSecret, tenantId, channel: req.body.channel });
  if (databaseEnabled) {
    const row = await prisma.marketplaceConnector.create({
      data: { id: memory.id, name, platform, channel: memory.channel, webhookSecret, tenantId, status: 'ACTIVE' },
    }).catch(() => memory);
    return res.status(201).json({ connector: { ...row, webhookSecret } });
  }
  return res.status(201).json({ connector: memory });
});

router.post('/connectors/:id/ingest', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const memoryConnector = findConnector(req.params.id);
  const connector = (memoryConnector && memoryConnector.tenantId === (req.companyId ?? DEFAULT_COMPANY_ID) ? memoryConnector : undefined)
    ?? (databaseEnabled ? await prisma.marketplaceConnector.findFirst({ where: { id: req.params.id, tenantId: req.companyId ?? DEFAULT_COMPANY_ID } }) : null);
  if (!connector) return res.status(404).json({ message: 'Connector not found.' });
  if (!tenantAllows(req.user!.companyId ?? 'default-company', 'connectors') && !tenantAllows('default-company', 'connectors')) {
    return res.status(403).json({ message: 'Marketplace connectors are not on the current plan.' });
  }
  const payloads = Array.isArray(req.body.orders) ? req.body.orders : [req.body];
  const created = [];
  const duplicates = [];
  const errors = [];
  for (const payload of payloads) {
    const mapped = mapMarketplaceOrder(connector.platform as ConnectorPlatform, payload && typeof payload === 'object' ? payload : {});
    const invalid = validateNormalizedOrder(mapped);
    if (invalid) { errors.push({ reference: mapped.externalReference, message: invalid }); continue; }
    const lines = [];
    for (const line of mapped.lines) {
      const memoryItem = listItems().find((entry) => entry.code === line.sku || entry.id === line.sku);
      const item = !databaseEnabled
        ? memoryItem
        : await prisma.item.findFirst({ where: { OR: [{ code: line.sku }, { id: line.sku }], companyId: req.companyId ?? DEFAULT_COMPANY_ID } }).catch(() => null) ?? memoryItem;
      if (!item) { errors.push({ reference: mapped.externalReference, message: `Unknown SKU ${line.sku}` }); continue; }
      lines.push({ itemId: item.id, quantity: line.quantity });
    }
    if (!lines.length) continue;
    try {
      const locations = databaseEnabled
        ? await prisma.location.findMany({ where: { status: 'ACTIVE', companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { id: true, name: true, type: true } })
        : listLocations().map((location) => ({ id: location.id, name: location.name, type: location.type }));
      const order = await createOrderWithReservation({
        channel: mapped.channel,
        externalReference: mapped.externalReference,
        customerName: mapped.customerName,
        notes: mapped.notes,
        createdById: req.user!.id,
        companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        allowSplit: true,
        candidateLocations: locations.map((location) => ({ locationId: location.id, locationName: location.name, locationType: location.type })),
        lines,
      });
      if (order.duplicate) duplicates.push(order); else created.push(order);
    } catch (error) {
      errors.push({ reference: mapped.externalReference, message: error instanceof Error ? error.message : 'Unable to reserve order.' });
    }
  }
  markConnectorIngested(connector.id);
  if (databaseEnabled) {
    await prisma.marketplaceConnector.update({ where: { id: connector.id }, data: { lastIngestedAt: new Date() } }).catch(() => undefined);
  }
  // A payload the platform already delivered is not an error: it is acknowledged with the order it produced.
  return res.status(created.length ? 201 : duplicates.length ? 200 : 409).json({ orders: created, duplicates, errors });
});

router.use(webhookDeliveriesRouter);

export default router;
