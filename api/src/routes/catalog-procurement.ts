import { loadSalesEvents } from '../lib/sales-demand.js';
import { newDocumentNumber } from '../lib/document-number.js';
import { suggestReorderRule } from '../lib/reorder-suggestion.js';
import { sellableParts } from '../lib/sellable-stock.js';
import { type Request, type Response, Router } from 'express';

import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { getActiveWorkflow, getIndustryPack, isSerialFieldName } from '../lib/industry-packs.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { listReorderRules, upsertReorderRule, validateReorderQuantities } from '../lib/reorder-store.js';
import { adjustQuarantineLedger, adjustStockLedger, ensureLotRecord, listItems } from '../lib/repository.js';
import { emitWebhookEvent } from '../lib/webhook-dispatcher.js';
import { allocateLandedCost, type LandedCostMethod } from '../lib/landed-cost.js';
import { computeVendorScore, computePriceVariance, supplierLeadTimeStats } from '../lib/vendor-score.js';
import { canOrderFrom, parseSupplierFields, presentSupplier } from '../lib/supplier-master.js';
import { checkPoMove, isPoStatus, isReceivablePo, type PoStatus } from '../lib/po-lifecycle.js';
import { planPoReceipt, statusAfterReceipt, type ItemRules, type ReceiptLineInput } from '../lib/po-receipt.js';
import { groupBySupplier, OPEN_PO_STATUSES, planPurchases, type PlanInput } from '../lib/po-planning.js';
import { assertReceiptQcComplete } from '../lib/qc-receive.js';
import { quarantineFailedLines, verdictForLine, type InspectionLike } from '../lib/qc-gate.js';
import { evaluateInspection, type QcCheckResult } from '../lib/qc-inspection.js';
import { checkApprovalGate } from '../lib/approval-rules.js';
import { createExceptionCase } from '../lib/exceptions.js';
import { matchThreeWay } from '../lib/three-way-match.js';
import { recordAudit } from '../lib/audit.js';
import { validatePrice } from '../lib/price-guardrails.js';
import { resolvePrice } from '../lib/price-resolution.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import { postInventoryMovementInTransaction } from '../lib/inventory-posting-service.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { applySavedViewFilter, type SavedViewFilterConfig } from '../lib/saved-view-filter.js';
import { transitionPurchaseOrderStatus } from '../lib/domain-policies.js';

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

// Tags, custom fields and their values are company scoped (audit T-1); an item or tag of another
// company resolves 404 exactly like a missing one.
const catalogCompany = (req: Request) => req.companyId ?? DEFAULT_COMPANY_ID;
const ownsItem = async (req: Request, itemId: string) => Boolean(await prisma.item.findFirst({ where: { id: itemId, companyId: catalogCompany(req) }, select: { id: true } }));

router.get('/catalog/tags', async (req, res) => {
  const tags = await prisma.tag.findMany({ where: { companyId: catalogCompany(req) }, orderBy: { name: 'asc' }, include: { _count: { select: { items: true } } } });
  return res.json({ tags });
});

router.post('/catalog/tags', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2) return res.status(400).json({ message: 'Tag name must be at least 2 characters.' });
  try {
    const tag = await prisma.tag.create({ data: { name, companyId: catalogCompany(req), color: req.body.color || 'emerald' } });
    return res.status(201).json({ tag });
  } catch {
    return res.status(409).json({ message: 'A tag with this name already exists.' });
  }
});

router.put('/catalog/items/:itemId/tags', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const requestedTagIds: string[] = Array.isArray(req.body.tagIds) ? req.body.tagIds.filter((id: unknown) => typeof id === 'string') : [];
  if (!(await ownsItem(req, req.params.itemId))) return res.status(404).json({ message: 'Item not found.' });
  const tagIds = (await prisma.tag.findMany({ where: { id: { in: requestedTagIds }, companyId: catalogCompany(req) }, select: { id: true } })).map((tag) => tag.id);
  if (tagIds.length !== new Set(requestedTagIds).size) return res.status(404).json({ message: 'Tag not found.' });
  await prisma.$transaction([
    prisma.itemTag.deleteMany({ where: { itemId: req.params.itemId } }),
    prisma.itemTag.createMany({ data: tagIds.map((tagId: string) => ({ itemId: req.params.itemId, tagId })), skipDuplicates: true }),
  ]);
  return res.json({ success: true });
});

router.get('/catalog/custom-fields', async (req, res) => {
  const fields = await prisma.customFieldDefinition.findMany({ where: { companyId: catalogCompany(req) }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return res.json({ fields });
});

router.post('/catalog/custom-fields', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const type = ['text', 'number', 'date', 'boolean', 'select'].includes(req.body.type) ? req.body.type : 'text';
  if (name.length < 2) return res.status(400).json({ message: 'Field name must be at least 2 characters.' });
  if (await prisma.customFieldDefinition.findFirst({ where: { companyId: catalogCompany(req), name }, select: { id: true } })) return res.status(409).json({ message: 'A custom field with this name already exists.' });
  const field = await prisma.customFieldDefinition.create({
    data: { name, companyId: catalogCompany(req), type, options: Array.isArray(req.body.options) ? req.body.options : undefined, required: Boolean(req.body.required) },
  });
  return res.status(201).json({ field });
});

router.get('/catalog/items/:itemId', async (req, res) => {
  if (!(await ownsItem(req, req.params.itemId))) return res.status(404).json({ message: 'Item not found.' });
  const [tags, values] = await Promise.all([
    prisma.itemTag.findMany({ where: { itemId: req.params.itemId }, include: { tag: true } }),
    prisma.customFieldValue.findMany({ where: { itemId: req.params.itemId }, include: { field: true } }),
  ]);
  return res.json({ tags: tags.map((entry) => entry.tag), customFields: values });
});

router.put('/catalog/items/:itemId/custom-fields/:fieldId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const value = req.body.value == null ? '' : String(req.body.value);
  if (!(await ownsItem(req, req.params.itemId))) return res.status(404).json({ message: 'Item not found.' });
  const field = await prisma.customFieldDefinition.findFirst({ where: { id: req.params.fieldId, companyId: catalogCompany(req) } });
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
  const rules = await prisma.reorderRule.findMany({ where: { locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, orderBy: { createdAt: 'asc' } });
  return res.json({ rules });
});

// Matches the Action Center's own dismissal TTL (operations-extension.ts) - a dismissed
// suggestion resurfaces after 24h if the underlying demand/rule gap is still real.
const REORDER_SUGGESTION_DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;

type ReorderSuggestionQuery = { windowDays: number; leadTimeDays: number; servicePercent: number };

function parseReorderSuggestionQuery(input: { windowDays?: unknown; leadTimeDays?: unknown; servicePercent?: unknown }): ReorderSuggestionQuery | null {
  const windowDays = Number(input.windowDays) > 0 ? Math.min(365, Number(input.windowDays)) : 60;
  const leadTimeDays = Number(input.leadTimeDays) > 0 ? Number(input.leadTimeDays) : 7;
  const servicePercent = Number(input.servicePercent) > 0 ? Number(input.servicePercent) : 95;
  if (servicePercent < 50 || servicePercent > 99.99) return null;
  return { windowDays, leadTimeDays, servicePercent };
}

// Shared by the list endpoint and the single-item accept endpoint, so accept always recomputes
// the suggestion server-side rather than trusting client-supplied numbers.
async function computeReorderSuggestions(companyId: string, locationId: string, query: ReorderSuggestionQuery, itemIds?: string[]) {
  const { windowDays, leadTimeDays, servicePercent } = query;
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const movements = await loadSalesEvents({ since, locationId, companyId });
  const byItem = new Map<string, Map<string, number>>();
  for (const m of movements) {
    if (itemIds && !itemIds.includes(m.itemId)) continue;
    const days = byItem.get(m.itemId) ?? new Map<string, number>();
    const day = m.timestamp.toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + m.qty);
    byItem.set(m.itemId, days);
  }
  const [items, rules] = await Promise.all([
    prisma.item.findMany({ where: { companyId, id: { in: [...byItem.keys()] } }, select: { id: true, code: true, name: true, decimalQuantity: true } }),
    prisma.reorderRule.findMany({ where: { locationId, companyId } }),
  ]);
  const ruleByItem = new Map(rules.map((rule) => [rule.itemId, rule]));
  return items.flatMap((item) => {
    const days = byItem.get(item.id)!;
    const dailyDemand = Array.from({ length: windowDays }, (_, offset) => days.get(new Date(since.getTime() + offset * 86_400_000).toISOString().slice(0, 10)) ?? 0);
    const rule = ruleByItem.get(item.id);
    const suggestion = suggestReorderRule({ itemId: item.id, dailyDemand, leadTimeDays, servicePercent, decimal: item.decimalQuantity, currentMin: rule?.minQty, currentTarget: rule?.targetQty });
    return suggestion ? [{ ...suggestion, code: item.code, name: item.name, decimal: item.decimalQuantity }] : [];
  });
}

router.get('/reorder-rules/suggestions', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!databaseEnabled) return res.status(501).json({ message: 'Reorder suggestions require a connected database.' });
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId }, select: { id: true } });
  if (!location) return res.status(404).json({ message: 'Location not found.' });
  const query = parseReorderSuggestionQuery(req.query);
  if (!query) return res.status(400).json({ message: 'servicePercent must be between 50 and 99.99.' });
  const dismissedSince = new Date(Date.now() - REORDER_SUGGESTION_DISMISSAL_TTL_MS);
  const [computed, dismissals] = await Promise.all([
    computeReorderSuggestions(companyId, locationId, query),
    prisma.intelligenceDismissal.findMany({ where: { locationId, type: 'REORDER_SUGGESTION', createdAt: { gte: dismissedSince } }, select: { itemId: true } }),
  ]);
  const dismissed = new Set(dismissals.map((d) => d.itemId));
  const suggestions = computed
    .filter((entry) => entry.change !== 'OK' && !dismissed.has(entry.itemId))
    .sort((a, b) => a.code.localeCompare(b.code));
  return res.json({ windowDays: query.windowDays, leadTimeDays: query.leadTimeDays, servicePercent: query.servicePercent, suggestions });
});

// Accept half of the suggestion's accept/dismiss flow (audit O-1): recomputes the suggestion for
// this one item server-side (never trusts client-supplied min/target) and writes it as the item's
// reorder rule through the same upsert PUT /reorder-rules/:itemId uses. Dismiss reuses the existing
// Action Center endpoint, POST /intelligence/:locationId/dismiss with type REORDER_SUGGESTION.
router.post('/reorder-rules/suggestions/:itemId/accept', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!databaseEnabled) return res.status(501).json({ message: 'Reorder suggestions require a connected database.' });
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId }, select: { id: true } });
  if (!location) return res.status(404).json({ message: 'Location not found.' });
  const query = parseReorderSuggestionQuery(req.body);
  if (!query) return res.status(400).json({ message: 'servicePercent must be between 50 and 99.99.' });
  const [suggestion] = await computeReorderSuggestions(companyId, locationId, query, [req.params.itemId]);
  if (!suggestion) return res.status(404).json({ message: 'No demand history to derive a suggestion from for this item at this location.' });
  const quantityProblem = validateReorderQuantities(suggestion.suggestedMin, suggestion.suggestedTarget, suggestion.decimal);
  if (quantityProblem) return res.status(400).json({ message: quantityProblem });
  const rule = await prisma.reorderRule.upsert({
    where: { itemId_locationId: { itemId: req.params.itemId, locationId } },
    update: { minQty: suggestion.suggestedMin, targetQty: suggestion.suggestedTarget },
    create: { itemId: req.params.itemId, locationId, minQty: suggestion.suggestedMin, targetQty: suggestion.suggestedTarget, companyId },
    include: { item: true },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'REORDER_RULE_ACCEPTED_FROM_SUGGESTION',
    entityType: 'ReorderRule', entityId: rule.id,
    metadata: { itemId: req.params.itemId, locationId, suggestedMin: suggestion.suggestedMin, suggestedTarget: suggestion.suggestedTarget, demandPattern: suggestion.demandPattern, change: suggestion.change },
  }));
  return res.json({ rule });
});

router.put('/reorder-rules/:itemId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : '';
  const minQty = Number(req.body.minQty);
  const targetQty = Number(req.body.targetQty);
  if (!locationId) return res.status(400).json({ message: 'Location, non-negative minimum and target not below minimum are required.' });
  const ruleItem = databaseEnabled
    ? await prisma.item.findFirst({ where: { id: req.params.itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { decimalQuantity: true } })
    : listItems().find((entry) => entry.id === req.params.itemId);
  const decimal = Boolean(ruleItem?.decimalQuantity);
  // Optional case pack: positive, or null to clear it.
  const orderMultiple = req.body.orderMultiple === undefined ? undefined : req.body.orderMultiple === null ? null : Number(req.body.orderMultiple);
  if (orderMultiple !== undefined && orderMultiple !== null && (!Number.isFinite(orderMultiple) || orderMultiple <= 0)) return res.status(400).json({ message: 'orderMultiple must be a positive number.' });
  const quantityProblem = validateReorderQuantities(minQty, targetQty, decimal);
  if (quantityProblem) return res.status(400).json({ message: quantityProblem });
  if (!databaseEnabled) {
    try {
      const rule = upsertReorderRule({ itemId: req.params.itemId, locationId, minQty, targetQty, decimal });
      return res.json({ rule });
    } catch (error) {
      return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save reorder rule.' });
    }
  }
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!location) return res.status(404).json({ message: 'Location not found.' });
  const rule = await prisma.reorderRule.upsert({
    where: { itemId_locationId: { itemId: req.params.itemId, locationId } },
    update: { minQty, targetQty, ...(orderMultiple !== undefined ? { orderMultiple } : {}) },
    create: { itemId: req.params.itemId, locationId, minQty, targetQty, orderMultiple: orderMultiple ?? null, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    include: { item: true },
  });
  return res.json({ rule });
});

router.get('/suppliers', async (req, res) => {
  const suppliers = await prisma.supplier.findMany({ where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID }, orderBy: { name: 'asc' } });
  return res.json({ suppliers: suppliers.map(presentSupplier) });
});

router.post('/suppliers', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const fields = parseSupplierFields(req.body ?? {}, true);
    const supplier = await prisma.supplier.create({ data: { ...fields, companyId: req.companyId ?? DEFAULT_COMPANY_ID } as never });
    return res.status(201).json({ supplier: presentSupplier(supplier) });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid supplier.' });
  }
});

router.put('/suppliers/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const fields = parseSupplierFields(req.body ?? {}, false);
    if (!Object.keys(fields).length) return res.status(400).json({ message: 'Nothing to update.' });
    const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
    if (!existing) return res.status(404).json({ message: 'Supplier not found.' });
    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data: fields as never });
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'SUPPLIER_UPDATED', entityType: 'Supplier', entityId: supplier.id, metadata: { fields: Object.keys(fields) } }));
    return res.json({ supplier: presentSupplier(supplier) });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid supplier.' });
  }
});

router.get('/suppliers/:id/price-breaks', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const supplier = await prisma.supplier.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
  if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
  const breaks = await prisma.supplierPriceBreak.findMany({ where: { supplierId: supplier.id, companyId }, orderBy: [{ itemId: 'asc' }, { minQty: 'asc' }] });
  return res.json({ priceBreaks: breaks.map((row) => ({ ...row, unitCost: Number(row.unitCost) })) });
});

// Replaces the whole ladder for one supplier + item: [{ minQty, unitCost }], quantities ascending with costs falling.
router.put('/suppliers/:id/price-breaks/:itemId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const tiers: Array<{ minQty: number; unitCost: number }> = Array.isArray(req.body.breaks) ? req.body.breaks.map((tier: any) => ({ minQty: Number(tier.minQty), unitCost: Number(tier.unitCost) })) : [];
  if (tiers.some((tier) => !Number.isFinite(tier.minQty) || tier.minQty <= 0 || !Number.isFinite(tier.unitCost) || tier.unitCost <= 0)) return res.status(400).json({ message: 'Every break needs a positive quantity and unit cost.' });
  const ordered = [...tiers].sort((a, b) => a.minQty - b.minQty);
  if (new Set(ordered.map((tier) => tier.minQty)).size !== ordered.length) return res.status(400).json({ message: 'Break quantities must be distinct.' });
  if (ordered.some((tier, index) => index > 0 && tier.unitCost >= ordered[index - 1].unitCost)) return res.status(400).json({ message: 'A larger quantity must have a lower unit cost.' });
  const [supplier, item] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } }),
    prisma.item.findFirst({ where: { id: req.params.itemId, companyId }, select: { id: true } }),
  ]);
  if (!supplier || !item) return res.status(404).json({ message: 'Supplier or item not found.' });
  await prisma.$transaction([
    prisma.supplierPriceBreak.deleteMany({ where: { supplierId: supplier.id, itemId: item.id } }),
    prisma.supplierPriceBreak.createMany({ data: ordered.map((tier) => ({ supplierId: supplier.id, itemId: item.id, minQty: tier.minQty, unitCost: tier.unitCost, companyId })) }),
  ]);
  return res.json({ priceBreaks: ordered });
});

router.get('/suppliers/:id/score', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const supplier = await prisma.supplier.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });

  const orders = await prisma.purchaseOrder.findMany({
    where: { supplierId: supplier.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID, status: { notIn: ['DRAFT', 'CANCELLED'] } },
    include: { lines: true },
  });
  // Completion is when the last goods arrived, not when finance later closed the order.
  const lastReceiptAt = new Map<string, Date>();
  for (const receipt of await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: { in: orders.map((order) => order.id) } }, select: { purchaseOrderId: true, createdAt: true } }).catch(() => [])) {
    const seen = lastReceiptAt.get(receipt.purchaseOrderId);
    if (!seen || receipt.createdAt > seen) lastReceiptAt.set(receipt.purchaseOrderId, receipt.createdAt);
  }
  const scoreInput = orders.map((order) => ({
    quantity: order.lines.reduce((sum, line) => sum + line.quantity, 0),
    receivedQty: order.lines.reduce((sum, line) => sum + line.receivedQty, 0),
    expectedAt: order.expectedAt ? order.expectedAt.toISOString() : null,
    completedAt: ['RECEIVED', 'CLOSED'].includes(order.status) ? (lastReceiptAt.get(order.id) ?? order.updatedAt).toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    orderedAt: (order.sentAt ?? order.approvedAt ?? order.createdAt).toISOString(),
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

// Bounded (audit O-8): newest first, at most `limit` (default 200, max 500) with a cursor for the next page,
// instead of loading every purchase order the company has ever raised on each request.
router.get('/purchase-orders', async (req, res) => {
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 500) : 200;
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
  const rows = await prisma.purchaseOrder.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    include: { supplier: true, lines: { include: { item: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const purchaseOrders = rows.slice(0, limit);
  return res.json({ purchaseOrders, nextCursor: rows.length > limit ? purchaseOrders[purchaseOrders.length - 1].id : null });
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
  const supplier = await prisma.supplier.findFirst({ where: { id: String(req.body.supplierId), companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
  if (!canOrderFrom((supplier as { status?: string }).status)) return res.status(409).json({ message: `${supplier.name} is ${String((supplier as { status?: string }).status).toLowerCase()} and cannot receive new purchase orders.` });
  const leadTimeDays = (supplier as { leadTimeDays?: number | null }).leadTimeDays;
  const lineItems = await prisma.item.findMany({ where: { id: { in: normalized.map((line) => line.itemId) }, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { id: true, code: true, status: true } });
  const missing = normalized.map((line) => line.itemId).filter((itemId) => !lineItems.some((row) => row.id === itemId));
  if (missing.length) return res.status(400).json({ message: `Item ${missing[0]} was not found.` });
  const inactive = lineItems.find((row) => (row as { status?: string }).status && (row as { status?: string }).status !== 'ACTIVE');
  if (inactive) return res.status(400).json({ message: `Item ${inactive.code} is ${String((inactive as { status?: string }).status).toLowerCase()} and cannot be ordered.` });
  const landedCostMethod = ['VALUE', 'WEIGHT', 'QUANTITY'].includes(req.body.landedCostMethod) ? req.body.landedCostMethod : 'VALUE';
  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      number: newDocumentNumber('PO'),
      supplierId: req.body.supplierId,
      locationId: req.body.locationId,
      createdById: req.user!.id,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      // Promise date: what the buyer said, else today plus the supplier's lead time.
      expectedAt: req.body.expectedAt ? new Date(req.body.expectedAt) : leadTimeDays ? new Date(Date.now() + leadTimeDays * 86_400_000) : null,
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

// Blueprint v4 §22/§18: receiving is lot/expiry aware, QC-gated, records damage and
// excess instead of hiding them, and is exactly-once per requestId.
router.post('/purchase-orders/:id/receive', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const requestId = typeof req.body.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!requestId || requestId.length > 191) return res.status(400).json({ message: 'A valid requestId is required for retry-safe receiving.' });

  const priorReceipt = await prisma.purchaseReceipt.findUnique({ where: { requestId } }).catch(() => null);
  if (priorReceipt) {
    if (priorReceipt.purchaseOrderId !== req.params.id) return res.status(409).json({ message: 'This requestId was already used for a different purchase order.' });
    return res.json({ ...(priorReceipt.result as Record<string, unknown>), duplicate: true });
  }

  const order = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true } });
  if (!order) return res.status(404).json({ message: 'Purchase order not found.' });
  if (!isReceivablePo(order.status)) return res.status(409).json({ message: `A purchase order in ${order.status} cannot be received. It must be approved and still open.` });

  const receipt: ReceiptLineInput[] = (Array.isArray(req.body.lines) ? req.body.lines : []).map((line: Record<string, unknown>) => ({
    lineId: String(line.lineId ?? ''),
    receivedQty: Number(line.receivedQty ?? 0),
    damagedQty: Number(line.damagedQty ?? 0),
    excessQty: Number(line.excessQty ?? 0),
    lotNo: typeof line.lotNo === 'string' ? line.lotNo : null,
    expiryDate: typeof line.expiryDate === 'string' && line.expiryDate ? line.expiryDate : null,
  }));
  const itemRows = await prisma.item.findMany({
    where: { id: { in: order.lines.map((line) => line.itemId) }, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    select: { id: true, code: true, category: true, lotRequired: true, expiryRequired: true },
  });
  const rules = new Map<string, ItemRules>(itemRows.map((row) => [row.id, { code: row.code, lotRequired: row.lotRequired ?? false, expiryRequired: row.expiryRequired ?? false }]));
  const plan = planPoReceipt({ orderNumber: order.number, lines: order.lines, receipt, items: rules });
  if (plan.ok === false) return res.status(400).json({ message: plan.message, lineId: plan.lineId });

  // QC gate (blueprint §25): a checklist must exist for every good-stock line, and a failed one
  // sends that line's goods to quarantine instead of sellable stock.
  const { listMemoryQcTemplates, listMemoryQcInspections } = await import('../lib/qc-inspection.js');
  const templates = await prisma.qcChecklistTemplate.findMany({ where: { active: true } }).catch(() => listMemoryQcTemplates().filter((row) => row.active));
  const inspections = (await prisma.qcInspection.findMany({ where: { sourceDocument: order.number } }).catch(() => listMemoryQcInspections().filter((row) => row.sourceDocument === order.number))) as unknown as InspectionLike[];
  const bodyInspections: InspectionLike[] = (Array.isArray(req.body.qcInspections) ? req.body.qcInspections : []).map((entry: { itemId?: string; lineId?: string; results?: Record<string, QcCheckResult> }) => ({
    itemId: entry.itemId ?? null, sourceLineId: entry.lineId ?? null, results: entry.results ?? null,
  }));
  const recorded = [...inspections, ...bodyInspections];
  const categoryOf = new Map(itemRows.map((row) => [row.id, row.category ?? null]));
  const qcCheck = assertReceiptQcComplete(
    plan.postings.map((posting) => ({
      lineId: posting.lineId, itemId: posting.itemId, itemCategory: categoryOf.get(posting.itemId) ?? null,
      receivedQty: posting.goodQty, hasInspection: verdictForLine(recorded, { itemId: posting.itemId, lineId: posting.lineId }) !== null,
    })),
    templates,
  );
  if (qcCheck.ok === false) return res.status(400).json({ message: qcCheck.message, itemId: qcCheck.itemId, lineId: qcCheck.lineId, code: 'QC_REQUIRED' });
  const gated = quarantineFailedLines(
    plan.postings.map((posting) => ({ ...posting, lotId: posting.lotNo, receivedQty: posting.goodQty })),
    (line) => verdictForLine(recorded, { itemId: line.itemId, lineId: line.lineId }),
  );
  const postings = gated.lines.map((line) => ({ ...line, goodQty: line.receivedQty, arrivedQty: Math.round((line.receivedQty + line.damagedQty) * 1000) / 1000 }));

  let outcome: { purchaseOrder: Awaited<ReturnType<typeof prisma.purchaseOrder.findUniqueOrThrow>>; postedStock: Array<{ itemId: string; lotId: string; lotNo: string; quantity: number; quarantined: number; beforeBalance: number; afterBalance: number }> };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const postedStock: Array<{ itemId: string; lotId: string; lotNo: string; quantity: number; quarantined: number; beforeBalance: number; afterBalance: number }> = [];
      for (const posting of postings) {
        await tx.purchaseOrderLine.update({ where: { id: posting.lineId }, data: { receivedQty: { increment: posting.arrivedQty } } });
        const existingLot = await tx.lot.findUnique({ where: { itemId_lotNo: { itemId: posting.itemId, lotNo: posting.lotNo } } });
        const expiry = posting.expiryDate ? new Date(posting.expiryDate) : null;
        if (existingLot?.expiryDate && expiry && existingLot.expiryDate.toISOString().slice(0, 10) !== posting.expiryDate) {
          throw new Error(`Lot ${posting.lotNo} already exists with expiry ${existingLot.expiryDate.toISOString().slice(0, 10)}; a lot number belongs to one batch.`);
        }
        const lot = existingLot ?? await tx.lot.create({
          data: { itemId: posting.itemId, lotNo: posting.lotNo, expiryDate: expiry, attributes: { source: 'purchase-order', purchaseOrderId: order.id } },
        });
        if (existingLot && !existingLot.expiryDate && expiry) await tx.lot.update({ where: { id: lot.id }, data: { expiryDate: expiry } });
        const quarantined = Math.round((posting.damagedQty + posting.excessQty) * 1000) / 1000;
        // Quarantined (damaged/excess) quantity is a different ledger bucket, not an
        // on-hand delta, so it stays a direct write; the sellable quantity goes
        // through the canonical posting service *inside this same transaction*, so
        // the journal row, ledger, audit and outbox commit with the receipt or not at all.
        if (quarantined > 0) {
          await tx.stockLedger.upsert({
            where: { itemId_lotId_locationId: { itemId: posting.itemId, lotId: lot.id, locationId: order.locationId } },
            update: { quarantine: { increment: quarantined }, version: { increment: 1 } },
            create: { itemId: posting.itemId, lotId: lot.id, locationId: order.locationId, onHand: 0, quarantine: quarantined, version: 1, companyId: order.companyId },
          });
        }
        let afterBalance: number;
        if (posting.goodQty > 0) {
          const posted = await postInventoryMovementInTransaction(tx, {
            tenant: { companyId: order.companyId, tenantId: DEFAULT_TENANT_ID, userId: req.user!.id, role: req.user!.role as TenantContext['role'] },
            itemId: posting.itemId, lotId: lot.id, locationId: order.locationId,
            movementType: 'PURCHASE_RECEIPT', qtyDelta: posting.goodQty,
            idempotencyKey: `po-receive:${requestId}:${posting.lineId}`,
            reason: 'Purchase order receive', sourceDocument: order.number, sourceLineId: posting.lineId, correlationId: order.id,
          });
          afterBalance = posted.balance.onHand;
        } else {
          afterBalance = (await tx.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId: posting.itemId, lotId: lot.id, locationId: order.locationId } } }))?.onHand ?? 0;
        }
        const ledger = { onHand: afterBalance };
        postedStock.push({
          itemId: posting.itemId, lotId: lot.id, lotNo: posting.lotNo, quantity: posting.goodQty, quarantined,
          beforeBalance: ledger.onHand - posting.goodQty, afterBalance: ledger.onHand,
        });
      }
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: order.id } });
      const status = statusAfterReceipt(order.lines, postings);
      void lines;
      const purchaseOrder = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status },
        include: { supplier: true, lines: { include: { item: true } } },
      });
      await tx.purchaseReceipt.create({
        data: { requestId, purchaseOrderId: order.id, receivedById: req.user!.id, result: JSON.parse(JSON.stringify({ purchaseOrder, stockPosted: postedStock })) },
      });
      return { purchaseOrder, postedStock };
    });
  } catch (error) {
    // Two identical requests at once: the loser hits the unique requestId and gets the winner's result.
    if ((error as { code?: string })?.code === 'P2002') {
      const winner = await prisma.purchaseReceipt.findUnique({ where: { requestId } });
      if (winner) return res.json({ ...(winner.result as Record<string, unknown>), duplicate: true });
    }
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to receive this purchase order.' });
  }
  const { purchaseOrder, postedStock } = outcome;
  for (const receipt of postedStock) {
    try {
      ensureLotRecord(receipt.itemId, receipt.lotNo, null, { source: 'purchase-order' }, receipt.lotId);
    } catch {
      // Item may not be in the in-memory catalogue during isolated tests.
    }
    if (receipt.quantity > 0) adjustStockLedger(receipt.itemId, receipt.lotId, order.locationId, receipt.quantity);
    if (receipt.quarantined > 0) adjustQuarantineLedger(receipt.itemId, receipt.lotId, order.locationId, receipt.quarantined);
  }
  // Damage and excess are cases to resolve, not silent balance changes (blueprint §26).
  for (const posting of postings) {
    const line = order.lines.find((row) => row.id === posting.lineId);
    const lotId = postedStock.find((row) => row.itemId === posting.itemId && row.lotNo === posting.lotNo)?.lotId ?? null;
    const base = { itemId: posting.itemId, lotId, locationId: order.locationId, sourceDocument: order.number, sourceLineId: posting.lineId, reportedById: req.user!.id, companyId: order.companyId };
    if (posting.damagedQty > 0) {
      void createExceptionCase({ ...base, type: 'DAMAGE', title: `Damaged receipt on ${order.number}`, description: `${posting.damagedQty} unit(s) arrived damaged or failed QC.`, quantity: posting.damagedQty });
    }
    if (posting.excessQty > 0) {
      void createExceptionCase({ ...base, type: 'EXCESS_RECEIPT', title: `Excess receipt on ${order.number}`, description: `${posting.excessQty} unit(s) beyond the ordered ${line?.quantity ?? ''}. Accept or refuse.`, quantity: posting.excessQty });
    }
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
  return res.json({ purchaseOrder, stockPosted: postedStock, duplicate: false });
});

router.patch('/purchase-orders/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const to = req.body.status;
  if (!isPoStatus(to)) return res.status(400).json({ message: 'Invalid purchase order status.' });
  const order = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true, supplierInvoices: { select: { status: true } } } });
  if (!order) return res.status(404).json({ message: 'Purchase order not found.' });
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 2000) : '';
  const check = checkPoMove({
    from: (isPoStatus(order.status) ? order.status : 'DRAFT') as PoStatus, to,
    anyReceived: order.lines.some((line) => line.receivedQty > 0),
    invoiceStatuses: order.supplierInvoices.map((invoice) => invoice.status), note,
  });
  if (check.ok === false) return res.status(409).json({ message: check.message });

  // Blueprint §27: approval is a policy gate (value / branch thresholds), not just a status flip.
  if (to === 'APPROVED') {
    const location = await prisma.location.findUnique({ where: { id: order.locationId }, select: { branchId: true } }).catch(() => null);
    const gate = await checkApprovalGate({
      triggerType: 'PO_APPROVE', entityType: 'PurchaseOrder', entityId: order.id,
      branchId: location?.branchId ?? null, value: order.totalAmount, requestedById: req.user!.id,
    });
    if (gate.blocked) return res.status(409).json({ message: gate.reason, approvalRequestId: gate.requestId, requiredApproverRole: gate.requiredApproverRole });
  }
  const now = new Date();
  const purchaseOrder = await transitionPurchaseOrderStatus({
    entityId: order.id,
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    to,
    actorId: req.user!.id,
    actorRole: req.user!.role,
    data: {
      ...(to === 'APPROVED' ? { approvedAt: now, approvedById: req.user!.id } : {}),
      ...(to === 'SENT' ? { sentAt: now } : {}),
      ...(to === 'CLOSED' ? { closedAt: now, closeNote: note || null } : {}),
    },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: `PURCHASE_ORDER_${to}`,
    entityType: 'PurchaseOrder', entityId: order.id, metadata: { from: order.status, ...(note ? { note } : {}) },
  }));
  return res.json({ purchaseOrder });
});

// Blueprint v4 §22 planning: recommend, with the working shown. Creating draft POs is a separate call.
router.get('/purchase-orders/plan', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!location) return res.status(404).json({ message: 'Location not found.' });
  const windowDays = Number(req.query.windowDays) > 0 ? Math.min(Number(req.query.windowDays), 180) : 30;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const rules = await prisma.reorderRule.findMany({ where: { locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  const itemIds = rules.map((rule) => rule.itemId);
  if (!itemIds.length) return res.json({ locationId, windowDays, suggestions: [], groups: [], skipped: [], note: 'No reorder rules are set for this location.' });

  const [items, ledger, openLines, transfers, sales, lastLines, suppliers] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, code: true, name: true, decimalQuantity: true } }),
    prisma.stockLedger.findMany({ where: { locationId, itemId: { in: itemIds } }, select: { itemId: true, onHand: true, reserved: true, lot: { select: { status: true, expiryDate: true } } } }),
    prisma.purchaseOrderLine.findMany({
      where: { itemId: { in: itemIds }, purchaseOrder: { locationId, status: { in: [...OPEN_PO_STATUSES] } } },
      select: { itemId: true, quantity: true, receivedQty: true },
    }),
    prisma.transfer.findMany({
      where: { destinationLocationId: locationId, status: { in: ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'] }, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
      include: { lines: true },
    }),
    loadSalesEvents({ since, locationId, itemIds }),
    prisma.purchaseOrderLine.findMany({
      where: { itemId: { in: itemIds }, purchaseOrder: { status: { not: 'CANCELLED' } } },
      select: { itemId: true, unitCost: true, purchaseOrder: { select: { supplierId: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.supplier.findMany({ where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }),
  ]);
  const sum = <T,>(rows: T[], pick: (row: T) => [string, number]) => {
    const totals = new Map<string, number>();
    for (const row of rows) { const [key, value] = pick(row); totals.set(key, (totals.get(key) ?? 0) + value); }
    return totals;
  };
  // Cover = stock that can actually be sold: blocked, quarantined and expired lots are not cover (audit O-6).
  const sellable = (rows: typeof ledger) => rows.map((row) => ({ ...sellableParts([row]), itemId: row.itemId }));
  const onHand = sum(sellable(ledger), (row) => [row.itemId, row.onHand]);
  const reserved = sum(sellable(ledger), (row) => [row.itemId, row.reserved]);
  const open = sum(openLines, (row) => [row.itemId, Math.max(0, row.quantity - row.receivedQty)]);
  const inTransit = sum(transfers.flatMap((transfer) => transfer.lines), (row) => [row.itemId, Math.max(0, row.requestedQty - row.receivedQty - row.damagedQty - row.shortageQty)]);
  const sold = sum(sales, (row) => [row.itemId, row.qty]);
  // The supplier an item was last bought from is the default; the buyer can change it in the draft.
  const lastSupplier = new Map<string, { supplierId: string; unitCost: number }>();
  for (const line of lastLines) if (!lastSupplier.has(line.itemId)) lastSupplier.set(line.itemId, { supplierId: line.purchaseOrder.supplierId, unitCost: line.unitCost });
  const catalog = new Map(items.map((item) => [item.id, item]));

  // Lead time measured from each supplier's own completed orders (placed -> last receipt), so the plan
  // can use real delivery times and their variability instead of a default (audit O-3).
  const history = await prisma.purchaseOrder.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, status: { in: ['RECEIVED', 'CLOSED'] }, createdAt: { gte: new Date(Date.now() - 365 * 86_400_000) } },
    select: { id: true, supplierId: true, createdAt: true, approvedAt: true, sentAt: true, updatedAt: true },
  });
  const receipts = history.length
    ? await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: { in: history.map((order) => order.id) } }, select: { purchaseOrderId: true, createdAt: true } }).catch(() => [])
    : [];
  const lastReceipt = new Map<string, Date>();
  for (const receipt of receipts) {
    const seen = lastReceipt.get(receipt.purchaseOrderId);
    if (!seen || receipt.createdAt > seen) lastReceipt.set(receipt.purchaseOrderId, receipt.createdAt);
  }
  const bySupplier = new Map<string, Array<{ completedAt: string; createdAt: string; orderedAt: string }>>();
  for (const order of history) {
    const list = bySupplier.get(order.supplierId) ?? [];
    list.push({ completedAt: (lastReceipt.get(order.id) ?? order.updatedAt).toISOString(), createdAt: order.createdAt.toISOString(), orderedAt: (order.sentAt ?? order.approvedAt ?? order.createdAt).toISOString() });
    bySupplier.set(order.supplierId, list);
  }

  const breakRows = await prisma.supplierPriceBreak.findMany({ where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, itemId: { in: itemIds } }, select: { supplierId: true, itemId: true, minQty: true, unitCost: true } });
  const breaksFor = (itemId: string, supplierId: string | undefined) => breakRows.filter((row) => row.itemId === itemId && row.supplierId === supplierId).map((row) => ({ minQty: row.minQty, unitCost: Number(row.unitCost) }));
  const planInputs: PlanInput[] = rules.map((rule) => ({
    priceBreaks: breaksFor(rule.itemId, lastSupplier.get(rule.itemId)?.supplierId),
    itemId: rule.itemId, code: catalog.get(rule.itemId)?.code, name: catalog.get(rule.itemId)?.name,
    onHand: onHand.get(rule.itemId) ?? 0, reserved: reserved.get(rule.itemId) ?? 0, minQty: rule.minQty, targetQty: rule.targetQty,
    openPoQty: open.get(rule.itemId) ?? 0, inTransitQty: inTransit.get(rule.itemId) ?? 0,
    avgDailyDemand: (sold.get(rule.itemId) ?? 0) / windowDays, demandDays: (sold.get(rule.itemId) ?? 0) > 0 ? windowDays : 0,
    orderMultiple: (rule as { orderMultiple?: number | null }).orderMultiple ?? null,
    decimal: Boolean(catalog.get(rule.itemId)?.decimalQuantity), unitCost: lastSupplier.get(rule.itemId)?.unitCost, supplierId: lastSupplier.get(rule.itemId)?.supplierId ?? null,
  }));
  // EOQ is opt-in: it needs the buyer's own cost of placing an order and yearly holding rate, which the system cannot know.
  const orderingCost = Number(req.query.orderingCost) > 0 ? Number(req.query.orderingCost) : undefined;
  const holdingRate = Number(req.query.holdingRatePercent) > 0 ? Number(req.query.holdingRatePercent) / 100 : undefined;
  const result = planPurchases({
    orderingCost, holdingRate, budget: Number(req.query.budget) >= 0 && req.query.budget !== undefined && req.query.budget !== '' ? Number(req.query.budget) : undefined,
    items: planInputs,
    suppliers: suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, measured: supplierLeadTimeStats(bySupplier.get(supplier.id) ?? []), leadTimeDays: (supplier as { leadTimeDays?: number | null }).leadTimeDays, moq: (supplier as { moq?: number | null }).moq, status: (supplier as { status?: string | null }).status })),
  });
  return res.json({ locationId, windowDays, ...result, groups: groupBySupplier(result.suggestions) });
});

// The human action: turn chosen suggestions into DRAFT purchase orders, one per supplier.
router.post('/purchase-orders/plan/draft', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : '';
  const groups: Array<{ supplierId?: string; lines?: Array<{ itemId?: string; quantity?: number; unitCost?: number }> }> = Array.isArray(req.body.groups) ? req.body.groups : [];
  if (!locationId || !groups.length) return res.status(400).json({ message: 'A location and at least one supplier group are required.' });
  const created = [];
  for (const group of groups) {
    const lines = (group.lines ?? []).map((line) => ({ itemId: String(line.itemId ?? ''), quantity: Number(line.quantity), unitCost: Number(line.unitCost ?? 0) }));
    if (!group.supplierId) return res.status(400).json({ message: 'Choose a supplier for every group before creating draft orders.' });
    if (!lines.length || lines.some((line) => !line.itemId || !Number.isFinite(line.quantity) || line.quantity <= 0)) return res.status(400).json({ message: 'Every line needs an item and a positive quantity.' });
    const supplier = await prisma.supplier.findFirst({ where: { id: group.supplierId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
    if (!canOrderFrom((supplier as { status?: string }).status)) return res.status(409).json({ message: `${supplier.name} cannot receive new purchase orders.` });
    const leadTimeDays = (supplier as { leadTimeDays?: number | null }).leadTimeDays;
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        number: newDocumentNumber('PO'),
        supplierId: supplier.id, locationId, createdById: req.user!.id,
        companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        expectedAt: leadTimeDays ? new Date(Date.now() + leadTimeDays * 86_400_000) : null,
        notes: 'Drafted from the purchase plan.',
        totalAmount: lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
        lines: { create: lines },
      },
      include: { supplier: true, lines: { include: { item: true } } },
    });
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'PURCHASE_ORDER_DRAFTED_FROM_PLAN', entityType: 'PurchaseOrder', entityId: purchaseOrder.id, metadata: { lines: lines.length } }));
    created.push(purchaseOrder);
  }
  return res.status(201).json({ purchaseOrders: created });
});

router.get('/purchase-orders/:id/invoices', async (req, res) => {
  if (!requireReportingRole(req, res)) return;
  const invoices = await prisma.supplierInvoice.findMany({
    where: { purchaseOrderId: req.params.id, purchaseOrder: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
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

  const order = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true } });
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

  const item = await prisma.item.findFirst({ where: { id: req.params.itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
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
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, OR: [{ ownerId: req.user!.id }, { isShared: true }] },
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
  const savedView = await prisma.savedView.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!savedView) return res.status(404).json({ message: 'Saved view not found.' });
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role) && savedView.ownerId !== req.user!.id) {
    return res.status(403).json({ message: 'Only the view owner or an Admin can delete this view.' });
  }
  await prisma.savedView.delete({ where: { id: savedView.id } });
  return res.status(204).send();
});

router.get('/saved-views/:id/items', async (req, res) => {
  const savedView = await prisma.savedView.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!savedView) return res.status(404).json({ message: 'Saved view not found.' });
  if (!savedView.isShared && savedView.ownerId !== req.user!.id && !['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'This saved view is private to its owner.' });
  }
  const items = await prisma.item.findMany({ where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { tags: true } });
  const filterableItems = items.map((item) => ({
    id: item.id, name: item.name, code: item.code, category: item.category, subcategory: item.subcategory,
    tagIds: item.tags.map((t) => t.tagId),
  }));
  const matched = applySavedViewFilter(filterableItems, savedView.filter as SavedViewFilterConfig);
  return res.json({ savedView, items: matched });
});

export default router;
