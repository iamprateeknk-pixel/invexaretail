import { type Request, type Response, Router } from 'express';

import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { getActiveWorkflow, getIndustryPack, isSerialFieldName } from '../lib/industry-packs.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { listReorderRules, upsertReorderRule } from '../lib/reorder-store.js';
import { adjustStockLedger, ensureLotRecord } from '../lib/repository.js';
import { emitWebhookEvent } from '../lib/webhook-dispatcher.js';
import { allocateLandedCost, type LandedCostMethod } from '../lib/landed-cost.js';
import { computeVendorScore, computePriceVariance } from '../lib/vendor-score.js';
import { matchThreeWay } from '../lib/three-way-match.js';
import { recordAudit } from '../lib/audit.js';
import { validatePrice } from '../lib/price-guardrails.js';
import { resolvePrice } from '../lib/price-resolution.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { applySavedViewFilter, type SavedViewFilterConfig } from '../lib/saved-view-filter.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides, respondWhenMemoryUnavailable);

function requireAdmin(req: Request, res: Response): boolean {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) {
    res.status(403).json({ message: 'Admin access required.' });
    return false;
  }
  return true;
}

function requireReportingRole(req: Request, res: Response): boolean {
  if (!['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)) {
    res.status(403).json({ message: 'Reporting access requires Admin or Auditor role.' });
    return false;
  }
  return true;
}

router.get('/catalog/tags', async (_req, res) => {
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { items: true } } } });
  return res.json({ tags });
});

router.post('/catalog/tags', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2) return res.status(400).json({ message: 'Tag name must be at least 2 characters.' });
  try {
    const tag = await prisma.tag.create({ data: { name, color: req.body.color || 'emerald' } });
    return res.status(201).json({ tag });
  } catch {
    return res.status(409).json({ message: 'A tag with this name already exists.' });
  }
});

router.put('/catalog/items/:itemId/tags', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const tagIds = Array.isArray(req.body.tagIds) ? req.body.tagIds.filter((id: unknown) => typeof id === 'string') : [];
  await prisma.$transaction([
    prisma.itemTag.deleteMany({ where: { itemId: req.params.itemId } }),
    prisma.itemTag.createMany({ data: tagIds.map((tagId: string) => ({ itemId: req.params.itemId, tagId })), skipDuplicates: true }),
  ]);
  return res.json({ success: true });
});

router.get('/catalog/custom-fields', async (_req, res) => {
  const fields = await prisma.customFieldDefinition.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return res.json({ fields });
});

router.post('/catalog/custom-fields', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const type = ['text', 'number', 'date', 'boolean', 'select'].includes(req.body.type) ? req.body.type : 'text';
  if (name.length < 2) return res.status(400).json({ message: 'Field name must be at least 2 characters.' });
  const field = await prisma.customFieldDefinition.create({
    data: { name, type, options: Array.isArray(req.body.options) ? req.body.options : undefined, required: Boolean(req.body.required) },
  });
  return res.status(201).json({ field });
});

router.get('/catalog/items/:itemId', async (req, res) => {
  const [tags, values] = await Promise.all([
    prisma.itemTag.findMany({ where: { itemId: req.params.itemId }, include: { tag: true } }),
    prisma.customFieldValue.findMany({ where: { itemId: req.params.itemId }, include: { field: true } }),
  ]);
  return res.json({ tags: tags.map((entry) => entry.tag), customFields: values });
});

router.put('/catalog/items/:itemId/custom-fields/:fieldId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const value = req.body.value == null ? '' : String(req.body.value);
  const field = await prisma.customFieldDefinition.findUnique({ where: { id: req.params.fieldId } });
  if (!field) return res.status(404).json({ message: 'Custom field was not found.' });
  const pack = getIndustryPack(getActiveWorkflow().industryKey);
  if (value.trim() && isSerialFieldName(field.name, pack)) {
    const duplicate = await prisma.customFieldValue.findFirst({
      where: { fieldId: field.id, value: value.trim(), NOT: { itemId: req.params.itemId } },
    });
    if (duplicate) return res.status(409).json({ message: `${field.name} must be unique across the catalogue.` });
  }
  const customField = await prisma.customFieldValue.upsert({
    where: { itemId_fieldId: { itemId: req.params.itemId, fieldId: req.params.fieldId } },
    update: { value },
    create: { itemId: req.params.itemId, fieldId: req.params.fieldId, value },
  });
  return res.json({ customField });
});

router.get('/reorder-rules', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role) && !(req.user!.locationIds ?? []).includes(locationId)) {
    return res.status(403).json({ message: 'Reorder rule location access denied.' });
  }
  // Stock screens only need the rule values. Avoid joining and sorting through
  // Item here: older Hostinger databases can carry a compatible ReorderRule
  // table while their Item relation metadata still differs, which made this
  // optional request return 500 and displayed "Module limited" everywhere.
  if (!databaseEnabled) {
    return res.json({ rules: listReorderRules(locationId) });
  }
  const rules = await prisma.reorderRule.findMany({ where: { locationId }, orderBy: { createdAt: 'asc' } });
  return res.json({ rules });
});

router.put('/reorder-rules/:itemId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : '';
  const minQty = Number(req.body.minQty);
  const targetQty = Number(req.body.targetQty);
  if (!locationId || !Number.isInteger(minQty) || minQty < 0 || !Number.isInteger(targetQty) || targetQty < minQty) {
    return res.status(400).json({ message: 'Location, non-negative minimum and target not below minimum are required.' });
  }
  if (!databaseEnabled) {
    try {
      const rule = upsertReorderRule({ itemId: req.params.itemId, locationId, minQty, targetQty });
      return res.json({ rule });
    } catch (error) {
      return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save reorder rule.' });
    }
  }
  const rule = await prisma.reorderRule.upsert({
    where: { itemId_locationId: { itemId: req.params.itemId, locationId } },
    update: { minQty, targetQty },
    create: { itemId: req.params.itemId, locationId, minQty, targetQty },
    include: { item: true },
  });
  return res.json({ rule });
});

router.get('/suppliers', async (_req, res) => {
  return res.json({ suppliers: await prisma.supplier.findMany({ orderBy: { name: 'asc' } }) });
});

router.post('/suppliers', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2) return res.status(400).json({ message: 'Supplier name must be at least 2 characters.' });
  const supplier = await prisma.supplier.create({ data: { name, email: req.body.email || null, phone: req.body.phone || null } });
  return res.status(201).json({ supplier });
});

router.get('/suppliers/:id/score', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });

  const orders = await prisma.purchaseOrder.findMany({
    where: { supplierId: supplier.id, status: { not: 'DRAFT' } },
    include: { lines: true },
  });
  const scoreInput = orders.map((order) => ({
    quantity: order.lines.reduce((sum, line) => sum + line.quantity, 0),
    receivedQty: order.lines.reduce((sum, line) => sum + line.receivedQty, 0),
    expectedAt: order.expectedAt ? order.expectedAt.toISOString() : null,
    completedAt: order.status === 'RECEIVED' ? order.updatedAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
  }));

  const inspections = await prisma.qcInspection.findMany({
    where: { sourceDocument: { in: orders.map((order) => order.number) } },
    select: { overallResult: true },
  }).catch(() => []);
  const quality = inspections.length
    ? { totalInspections: inspections.length, failedInspections: inspections.filter((row) => row.overallResult !== 'PASS').length }
    : undefined;

  const itemPricesByItem = new Map<string, Array<{ unitCost: number; at: string }>>();
  for (const order of orders) {
    for (const line of order.lines) {
      const list = itemPricesByItem.get(line.itemId) ?? [];
      list.push({ unitCost: line.unitCost, at: order.createdAt.toISOString() });
      itemPricesByItem.set(line.itemId, list);
    }
  }
  const priceVarianceByItem = Object.fromEntries(
    [...itemPricesByItem.entries()]
      .map(([itemId, prices]) => [itemId, computePriceVariance(prices)])
      .filter(([, variance]) => variance !== null),
  );

  return res.json({
    supplier,
    score: computeVendorScore(scoreInput, quality),
    priceVarianceByItem,
  });
});

router.get('/purchase-orders', async (_req, res) => {
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    include: { supplier: true, lines: { include: { item: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ purchaseOrders });
});

router.post('/purchase-orders', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!req.body.supplierId || !req.body.locationId || lines.length === 0) {
    return res.status(400).json({ message: 'Supplier, destination and at least one line are required.' });
  }
  const normalized = lines.map((line: { itemId?: string; quantity?: number; unitCost?: number }) => ({
    itemId: String(line.itemId || ''), quantity: Number(line.quantity), unitCost: Number(line.unitCost || 0),
  }));
  if (normalized.some((line) => !line.itemId || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
    return res.status(400).json({ message: 'Every line requires an item and positive quantity.' });
  }
  const landedCostMethod = ['VALUE', 'WEIGHT', 'QUANTITY'].includes(req.body.landedCostMethod) ? req.body.landedCostMethod : 'VALUE';
  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      number: `PO-${Date.now().toString().slice(-8)}`,
      supplierId: req.body.supplierId,
      locationId: req.body.locationId,
      createdById: req.user!.id,
      expectedAt: req.body.expectedAt ? new Date(req.body.expectedAt) : null,
      notes: req.body.notes || null,
      totalAmount: normalized.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
      freightCost: Number(req.body.freightCost) || 0,
      customsCost: Number(req.body.customsCost) || 0,
      insuranceCost: Number(req.body.insuranceCost) || 0,
      handlingCost: Number(req.body.handlingCost) || 0,
      landedCostMethod,
      lines: { create: normalized },
    },
    include: { supplier: true, lines: { include: { item: true } } },
  });
  return res.status(201).json({ purchaseOrder });
});

router.post('/purchase-orders/:id/receive', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const receiptLines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { lines: true } });
  if (!order) return res.status(404).json({ message: 'Purchase order not found.' });
  const quantities = new Map<string, number>(
    receiptLines.map((line: { lineId?: string; receivedQty?: number }): [string, number] => [String(line.lineId), Number(line.receivedQty)]),
  );
  for (const line of order.lines) {
    const quantity = quantities.get(line.id) ?? 0;
    if (!Number.isFinite(quantity) || quantity < 0 || line.receivedQty + quantity > line.quantity) {
      return res.status(400).json({ message: `Invalid received quantity for line ${line.id}.` });
    }
  }
  const { purchaseOrder, postedStock } = await prisma.$transaction(async (tx) => {
    const postedStock: Array<{ itemId: string; lotId: string; quantity: number; beforeBalance: number; afterBalance: number }> = [];
    for (const line of order.lines) {
      const quantity = quantities.get(line.id) ?? 0;
      if (quantity > 0) {
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: { increment: quantity } } });
        const lotNo = `PO-${order.number}`;
        const lot = await tx.lot.upsert({
          where: { itemId_lotNo: { itemId: line.itemId, lotNo } },
          update: {},
          create: { itemId: line.itemId, lotNo, attributes: { source: 'purchase-order', purchaseOrderId: order.id } },
        });
        const ledger = await tx.stockLedger.upsert({
          where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: lot.id, locationId: order.locationId } },
          update: { onHand: { increment: quantity }, version: { increment: 1 } },
          create: { itemId: line.itemId, lotId: lot.id, locationId: order.locationId, onHand: quantity, version: 1 },
        });
        postedStock.push({
          itemId: line.itemId,
          lotId: lot.id,
          quantity,
          beforeBalance: ledger.onHand - quantity,
          afterBalance: ledger.onHand,
        });
      }
    }
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: order.id } });
    const received = lines.every((line) => line.receivedQty >= line.quantity);
    const partiallyReceived = lines.some((line) => line.receivedQty > 0);
    const purchaseOrder = await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: received ? 'RECEIVED' : partiallyReceived ? 'PARTIALLY_RECEIVED' : order.status },
      include: { supplier: true, lines: { include: { item: true } } },
    });
    return { purchaseOrder, postedStock };
  });
  for (const receipt of postedStock) {
    try {
      ensureLotRecord(receipt.itemId, `PO-${order.number}`, null, { source: 'purchase-order' }, receipt.lotId);
    } catch {
      // Item may not be in the in-memory catalogue during isolated tests.
    }
    adjustStockLedger(receipt.itemId, receipt.lotId, order.locationId, receipt.quantity);
    await prisma.stockMovement.create({
      data: {
        itemId: receipt.itemId,
        lotId: receipt.lotId,
        locationId: order.locationId,
        movementType: 'PURCHASE_RECEIPT',
        qtyDelta: receipt.quantity,
        beforeBalance: receipt.beforeBalance,
        afterBalance: receipt.afterBalance,
        sourceDocument: order.number,
        actor: req.user!.id,
        timestamp: new Date(),
        correlationId: order.id,
        reason: 'Purchase order receive',
      },
    }).catch(() => undefined);
  }

  // Blueprint P7 "Landed cost": if this PO carries freight/customs/
  // insurance/handling charges, allocate them across this receipt's lines
  // and stamp the true landed unit cost onto each received lot - never
  // touches the ledger, purely a cost attribute for margin truth.
  const totalLandedCharges = (order.freightCost ?? 0) + (order.customsCost ?? 0) + (order.insuranceCost ?? 0) + (order.handlingCost ?? 0);
  if (totalLandedCharges > 0 && postedStock.length) {
    const unitCostByItem = new Map(order.lines.map((line) => [line.itemId, line.unitCost]));
    const lineWeights = req.body.lineWeights && typeof req.body.lineWeights === 'object' ? req.body.lineWeights as Record<string, unknown> : {};
    const method = (order.landedCostMethod as LandedCostMethod) ?? 'VALUE';
    const allocations = allocateLandedCost(
      postedStock.map((receipt) => ({
        itemId: receipt.itemId,
        quantity: receipt.quantity,
        unitCost: unitCostByItem.get(receipt.itemId) ?? 0,
        weightKg: typeof lineWeights[receipt.itemId] === 'number' ? (lineWeights[receipt.itemId] as number) : null,
      })),
      { freight: order.freightCost ?? 0, customs: order.customsCost ?? 0, insurance: order.insuranceCost ?? 0, handling: order.handlingCost ?? 0 },
      method,
    );
    for (let index = 0; index < postedStock.length; index += 1) {
      const receipt = postedStock[index];
      const allocation = allocations[index];
      const lot = await prisma.lot.findUnique({ where: { id: receipt.lotId } });
      const attributes = (lot?.attributes && typeof lot.attributes === 'object' ? lot.attributes : {}) as Record<string, unknown>;
      await prisma.lot.update({
        where: { id: receipt.lotId },
        data: { attributes: { ...attributes, landedUnitCost: allocation.landedUnitCost, landedCostAllocatedCharge: allocation.allocatedCharge, landedCostMethod: method } },
      }).catch(() => undefined);
    }
  }

  void emitWebhookEvent({
    type: 'purchase-order.received',
    entityId: purchaseOrder.id,
    data: {
      purchaseOrderId: purchaseOrder.id,
      status: purchaseOrder.status,
      locationId: order.locationId,
      stockPosted: postedStock,
    },
  });
  return res.json({ purchaseOrder, stockPosted: postedStock });
});

router.patch('/purchase-orders/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const allowed = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ message: 'Invalid purchase order status.' });
  const purchaseOrder = await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: { status: req.body.status } });
  return res.json({ purchaseOrder });
});

router.get('/purchase-orders/:id/invoices', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const invoices = await prisma.supplierInvoice.findMany({
    where: { purchaseOrderId: req.params.id },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ invoices });
});

router.post('/purchase-orders/:id/invoices', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const invoiceNumber = typeof req.body.invoiceNumber === 'string' ? req.body.invoiceNumber.trim() : '';
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!invoiceNumber || !lines.length) return res.status(400).json({ message: 'Invoice number and at least one line are required.' });
  const normalizedLines = lines
    .map((line: { itemId?: string; invoicedQty?: number; unitCost?: number }) => ({
      itemId: String(line.itemId || ''), invoicedQty: Number(line.invoicedQty), unitCost: Number(line.unitCost),
    }))
    .filter((line: { itemId: string; invoicedQty: number; unitCost: number }) => line.itemId && Number.isFinite(line.invoicedQty) && line.invoicedQty > 0);
  if (!normalizedLines.length) return res.status(400).json({ message: 'Every line requires an item and a positive invoiced quantity.' });

  const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { lines: true } });
  if (!order) return res.status(404).json({ message: 'Purchase order not found.' });

  const poLines = order.lines.map((line) => ({ itemId: line.itemId, orderedQty: line.quantity, receivedQty: line.receivedQty, unitCost: line.unitCost }));
  const tolerancePercent = Number.isFinite(Number(req.body.tolerancePercent)) ? Number(req.body.tolerancePercent) : undefined;
  const matchResult = matchThreeWay(poLines, normalizedLines, tolerancePercent);

  const invoice = await prisma.supplierInvoice.create({
    data: {
      purchaseOrderId: order.id,
      invoiceNumber,
      invoiceDate: req.body.invoiceDate ? new Date(req.body.invoiceDate) : null,
      totalAmount: normalizedLines.reduce((sum, line) => sum + line.invoicedQty * line.unitCost, 0),
      status: matchResult.matched ? 'MATCHED' : 'EXCEPTION',
      matchResult: matchResult as unknown as object,
      createdById: req.user!.id,
      lines: { create: normalizedLines },
    },
    include: { lines: true },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'SUPPLIER_INVOICE_MATCHED',
    entityType: 'SupplierInvoice', entityId: invoice.id,
    metadata: { purchaseOrderId: order.id, status: invoice.status, exceptionLines: matchResult.lines.filter((line) => line.exceptions.length).length },
  }));
  return res.status(201).json({ invoice, matchResult });
});

// Blueprint P9 "Retail pricing: MRP, retail, wholesale, institutional, web,
// marketplace, branch, customer group, promotional price" with guardrails
// (lib/price-guardrails.ts). branchId null means company-wide; the most
// branch-specific, currently-effective row wins when resolving a price.
router.get('/items/:itemId/prices', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const priceType = typeof req.query.priceType === 'string' ? req.query.priceType : undefined;
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const priceLists = await prisma.priceList.findMany({
    where: {
      itemId: req.params.itemId,
      ...(priceType ? { priceType } : {}),
      ...(branchId ? { branchId } : {}),
    },
    orderBy: [{ priceType: 'asc' }, { branchId: 'asc' }, { effectiveFrom: 'desc' }],
  });
  return res.json({ priceLists });
});

// Blueprint P9 price resolution: the one price that actually applies to
// this item, right now, for the given branch/customer-group - resolved
// deterministically via lib/price-resolution.ts's "most specific,
// currently effective" rule, never an average across the price list.
router.get('/items/:itemId/price', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const priceType = typeof req.query.priceType === 'string' ? req.query.priceType : 'RETAIL';
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : null;
  const customerGroup = typeof req.query.customerGroup === 'string' ? req.query.customerGroup : null;
  const at = typeof req.query.at === 'string' ? req.query.at : undefined;
  const candidates = await prisma.priceList.findMany({ where: { itemId: req.params.itemId, priceType } });
  const resolved = resolvePrice(
    candidates.map((row) => ({
      id: row.id, price: row.price, branchId: row.branchId, customerGroup: row.customerGroup,
      effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString() ?? null, status: row.status,
    })),
    { branchId, customerGroup, at },
  );
  if (!resolved) return res.status(404).json({ message: `No effective ${priceType} price found for this item.` });
  return res.json({ price: resolved });
});

router.post('/items/:itemId/prices', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const priceType = typeof req.body.priceType === 'string' ? req.body.priceType.trim() : '';
  const proposedPrice = Number(req.body.price);
  if (!priceType || !Number.isFinite(proposedPrice) || proposedPrice <= 0) {
    return res.status(400).json({ message: 'A price type and a positive price are required.' });
  }

  const item = await prisma.item.findUnique({ where: { id: req.params.itemId } });
  if (!item) return res.status(404).json({ message: 'Item not found.' });

  const effectiveFrom = req.body.effectiveFrom ? String(req.body.effectiveFrom) : null;
  const effectiveTo = req.body.effectiveTo ? String(req.body.effectiveTo) : null;
  const minMarginPercent = Number.isFinite(Number(req.body.minMarginPercent)) ? Number(req.body.minMarginPercent) : null;
  const mrp = Number.isFinite(Number(req.body.mrp)) ? Number(req.body.mrp) : null;
  const landedCost = Number.isFinite(Number(req.body.landedCost)) ? Number(req.body.landedCost) : null;

  const guardrail = validatePrice({ proposedPrice, mrp, landedCost, minMarginPercent, effectiveFrom, effectiveTo });
  if (!guardrail.ok) {
    return res.status(422).json({ message: 'Price violates a guardrail.', guardrail });
  }

  const priceList = await prisma.priceList.create({
    data: {
      itemId: item.id,
      priceType,
      branchId: typeof req.body.branchId === 'string' ? req.body.branchId : null,
      customerGroup: typeof req.body.customerGroup === 'string' ? req.body.customerGroup : null,
      price: proposedPrice,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      createdById: req.user!.id,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'PRICE_LIST_CREATED',
    entityType: 'PriceList', entityId: priceList.id,
    metadata: { itemId: item.id, priceType, price: proposedPrice, warnings: guardrail.violations.map((v) => v.code) },
  }));
  return res.status(201).json({ priceList, guardrail });
});

router.get('/saved-reports', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const savedReports = await prisma.savedReport.findMany({
    where: { OR: [{ ownerId: req.user!.id }, { isShared: true }] },
    orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
  });
  return res.json({ savedReports });
});

router.post('/saved-reports', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const reportType = typeof req.body.reportType === 'string' ? req.body.reportType : '';
  const allowedTypes = ['inventory', 'low-stock', 'moves', 'variance', 'expiry', 'activity'];
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : null;
  if (name.length < 2 || !allowedTypes.includes(reportType)) {
    return res.status(400).json({ message: 'Report name and a supported report type are required.' });
  }
  if (locationId && !['ADMIN', 'ADMIN_USER'].includes(req.user!.role) && !(req.user!.locationIds ?? []).includes(locationId)) {
    return res.status(403).json({ message: 'Saved report location access denied.' });
  }
  const savedReport = await prisma.savedReport.create({
    data: {
      ownerId: req.user!.id,
      name,
      reportType,
      locationId,
      config: req.body.config && typeof req.body.config === 'object' ? req.body.config : undefined,
      isShared: ['ADMIN', 'ADMIN_USER'].includes(req.user!.role) && Boolean(req.body.isShared),
    },
  });
  return res.status(201).json({ savedReport });
});

router.delete('/saved-reports/:id', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const savedReport = await prisma.savedReport.findUnique({ where: { id: req.params.id } });
  if (!savedReport) return res.status(404).json({ message: 'Saved report not found.' });
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role) && savedReport.ownerId !== req.user!.id) {
    return res.status(403).json({ message: 'Only the report owner or an Admin can delete this report.' });
  }
  await prisma.savedReport.delete({ where: { id: savedReport.id } });
  return res.status(204).send();
});

// Blueprint "Folders/tags/views: saved smart folders/views" - a saved
// filter (lib/saved-view-filter.ts), re-run against the live item list on
// every GET .../items call rather than holding a static, staleness-prone
// snapshot of item ids.
router.get('/saved-views', async (req, res) => {
  const savedViews = await prisma.savedView.findMany({
    where: { OR: [{ ownerId: req.user!.id }, { isShared: true }] },
    orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
  });
  return res.json({ savedViews });
});

router.post('/saved-views', async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2) return res.status(400).json({ message: 'A saved view name is required.' });
  const filter = req.body.filter && typeof req.body.filter === 'object' ? req.body.filter : {};
  const savedView = await prisma.savedView.create({
    data: {
      ownerId: req.user!.id,
      name,
      entityType: typeof req.body.entityType === 'string' ? req.body.entityType : 'ITEM',
      filter,
      isShared: ['ADMIN', 'ADMIN_USER'].includes(req.user!.role) && Boolean(req.body.isShared),
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    },
  });
  return res.status(201).json({ savedView });
});

router.delete('/saved-views/:id', async (req, res) => {
  const savedView = await prisma.savedView.findUnique({ where: { id: req.params.id } });
  if (!savedView) return res.status(404).json({ message: 'Saved view not found.' });
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role) && savedView.ownerId !== req.user!.id) {
    return res.status(403).json({ message: 'Only the view owner or an Admin can delete this view.' });
  }
  await prisma.savedView.delete({ where: { id: savedView.id } });
  return res.status(204).send();
});

router.get('/saved-views/:id/items', async (req, res) => {
  const savedView = await prisma.savedView.findUnique({ where: { id: req.params.id } });
  if (!savedView) return res.status(404).json({ message: 'Saved view not found.' });
  if (!savedView.isShared && savedView.ownerId !== req.user!.id && !['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'This saved view is private to its owner.' });
  }
  const items = await prisma.item.findMany({ include: { tags: true } });
  const filterableItems = items.map((item) => ({
    id: item.id, name: item.name, code: item.code, category: item.category, subcategory: item.subcategory,
    tagIds: item.tags.map((t) => t.tagId),
  }));
  const matched = applySavedViewFilter(filterableItems, savedView.filter as SavedViewFilterConfig);
  return res.json({ savedView, items: matched });
});

export default router;
