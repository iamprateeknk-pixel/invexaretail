// Returns/RMA routes for operations-extension (Phase 4): extracted
// verbatim from operations-extension.ts; the composer mounts this
// router at the cluster's original position.
import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { ensureLotRecord, listItems } from '../lib/repository.js';
import { createExceptionCase } from '../lib/exceptions.js';
import { expireStaleReservations, retryBackorderedOrders, retryBackorderAllocation } from '../lib/orders.js';
import { listMemoryQcTemplates, listMemoryQcInspections, findTemplateForCategory } from '../lib/qc-inspection.js';
import { canCloseReturn, isPendingDisposition, nextReturnStatus, parseRefundDecision, planReturnLine, validateReturnLines, type ReturnAction } from '../lib/returns-rma.js';
import { transitionReturnStatus } from '../lib/domain-policies.js';
import { verdictForLine, type InspectionLike } from '../lib/qc-gate.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { postInventoryMovementInTransaction } from '../lib/inventory-posting-service.js';
import { tenantContextOf, canAccessLocation, requireAdmin, requirePacker } from './opext-shared.js';

const router = Router();

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
        // Phase 5 step 14: the canonical posting above is the stock
        // write; the snapshot mirror that followed it is retired (this
        // router is database-only — returns have no memory-mode flow).
      } else if (plan.action === 'HOLD') {
        // Physically back in the building but not sellable: quarantine until a disposition is decided.
        await prisma.stockLedger.upsert({
          where: { companyId_itemId_lotId_locationId: { companyId: returnRequest.companyId, itemId: line.itemId, lotId: lot.id, locationId } },
          update: { quarantine: { increment: line.quantity }, version: { increment: 1 } },
          create: { companyId: returnRequest.companyId, itemId: line.itemId, lotId: lot.id, locationId, onHand: 0, quarantine: line.quantity, version: 1 },
        });
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

  const lineQty = Number(line.quantity);
  const qc = await returnQcContext(returnRequest.companyId, returnRequest.id, [line.itemId]);
  const plan = planReturnLine({ requested: String(req.body.disposition ?? ''), qcRequired: qc.qcRequired(line.itemId), verdict: qc.verdict(line.itemId, line.id) });
  if ('message' in plan) return res.status(400).json({ message: plan.message });
  if (plan.action === 'HOLD') return res.status(409).json({ message: plan.note ?? 'This line must stay in quarantine.' });

  const locationId = returnRequest.order.fulfillmentLocationId;
  const lot = await returnLot(returnRequest.id, line.itemId);
  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: returnRequest.companyId, itemId: line.itemId, lotId: lot.id, locationId } } });
  if (!ledger || Number(ledger.quarantine) + 1e-8 < lineQty) return res.status(409).json({ message: 'The quarantined quantity for this line was not found.' });
  const restock = plan.action === 'RESTOCK';
  await prisma.$transaction(async (tx) => {
    await tx.stockLedger.update({
      where: { id: ledger.id },
      data: {
        quarantine: { decrement: lineQty },
        ...(plan.action === 'SCRAP' ? { damaged: { increment: lineQty } } : {}),
        version: { increment: 1 },
      },
    });
    if (restock) {
      await postInventoryMovementInTransaction(tx, {
        tenant: tenantContextOf(req), itemId: line.itemId, lotId: lot.id, locationId,
        movementType: 'SALES_RETURN', qtyDelta: lineQty,
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
          reason: `Return disposition: ${plan.disposition}`, metadata: { quarantineDelta: -lineQty },
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        } as never,
      });
    }
  });
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

export default router;
