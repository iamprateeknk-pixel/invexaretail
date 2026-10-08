// Week 8: the first bounded-context router extracted out of the "god
// router" (routes/core.ts, 3885 lines / 93 handlers before this week).
// Thin route -> command/query service -> domain policy -> repository, per
// the guide's Week 8 scope. Only two of core.ts's 27 Transfer routes move
// here this pass (GET /transfers/list, POST /transfers) - the rest are
// tracked as backlog in docs/route-ownership-matrix.md, not silently
// dropped. Behavior is unchanged from the handlers this replaces in
// core.ts: same validation, same reservation call, same audit trail, same
// response shapes - verified by transfers.parity.test.ts running the exact
// request/response pairs the old inline handlers were covered by.
import { Router, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { isDomainError, statusForErrorCode } from '../lib/errors.js';
import type { AccessContext, Role, TransferInput } from '../lib/inventory.js';
import { listTransfersForContext } from '../lib/repositories/transfer-repository.js';
import { createTransfer, TransferRoleError, TransferValidationError, TransferExpiryBlockedError, InsufficientStockError } from '../lib/transfer-command-service.js';
import type { EnhancedUserRecord } from '../lib/enterprise-repository.js';
import { canCreateTransfer, parseCartonCount } from '../lib/transfer-lifecycle.js';
import { validateTransferRequest, validateTransferStatusChange, canAccessLocation } from '../lib/inventory.js';
import { persistTransferReplacement, persistTransferDeletion, persistTransferStatus, persistAudit } from '../lib/persistence.js';
import { replaceTransferRecord, listTransferCartons, removeTransferRecord, updateTransferStatus, findTransferForCompany, listItems, listLocations, type TransferRecord } from '../lib/repository.js';
import { activeCartons } from '../lib/transfer-packing.js';
import { TERMINAL_TRANSFER_STATUSES, releaseReservedStock } from '../lib/reservation.js';
import { emitTransferUpdated } from '../lib/webhook-dispatcher.js';
import { getActiveWorkflow } from '../lib/industry-packs.js';
import { recordAudit } from '../lib/audit.js';
import { isOperationalItem } from '../lib/item-master.js';
import { savedPickSlips } from '../lib/transfer-pick-slips.js';
import { listStockLedgerForLocation, adjustStockLedger, updateTransferReceiptProgress, adjustQuarantineLedger, listTransfers } from '../lib/repository.js';
import { isPooledPick, allocatePick, isPickableLot } from '../lib/kg-pick.js';
import { validatePickInput, PICK_EXCEPTION_REASONS } from '../lib/warehouse-workflow.js';
import { createExceptionCase, estimateValueAtRisk } from '../lib/exceptions.js';
import { prisma } from '../lib/db.js';
import { checkApprovalGate } from '../lib/approval-rules.js';
import { persistConfirmedPickAllocations, databaseEnabled } from '../lib/persistence.js';
import { DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import { canReceiveTransfer, type ReceiptLineInput, validateReceiptLines } from '../lib/receipt-validation.js';
import { findReceiptByRequestId, beginReceiptRequest, persistTransferReceipt, rememberReceipt, endReceiptRequest } from '../lib/transfer-receipt.js';
import { isReceivableStatus } from '../lib/transfer-lifecycle.js';
import { requireEvidenceForDamage } from '../lib/evidence-rules.js';
import { assertReceiptQcComplete } from '../lib/qc-receive.js';
import { type InspectionLike, quarantineFailedLines, verdictForLine } from '../lib/qc-gate.js';
import { type QcCheckResult } from '../lib/qc-inspection.js';
import { createPutawayTask } from '../lib/putaway.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { persistBinStockDelta, STAGING_BIN_ID } from '../lib/bin-stock.js';

const router = Router();

// Identical auth chain to routes/core.ts's router (this file replaces two
// of that router's routes, so it must enforce exactly what they did - no
// new route can bypass tenant/auth/permission middleware by mounting here
// instead of there; see transfers.authz.test.ts).
router.use(extractToken, requireAuth, enforcePermissionOverrides);

// Duplicated 1:1 from core.ts's local `accessContext` helper rather than
// extracted into a shared module this week - a 3-line pure function, and
// consolidating file-local helpers that are used dozens of times elsewhere
// in core.ts is exactly the kind of larger refactor this week's extraction
// backlog (docs/route-ownership-matrix.md) defers rather than rushes.
const INVENTORY_ROLES: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
function accessContext(user: EnhancedUserRecord): AccessContext {
  const role = INVENTORY_ROLES.includes(user.role) ? (user.role as Role) : 'STORE_USER';
  return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}

router.get('/transfers/list', (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  return res.json({ transfers: listTransfersForContext(context) });
});

router.post('/transfers', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const input = req.body as TransferInput;

  try {
    const saved = await createTransfer({
      context,
      input,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      requestId: res.locals.requestId,
      traceId: res.locals.requestId,
    });
    return res.status(201).json({ success: true, transfer: saved });
  } catch (error) {
    if (error instanceof InsufficientStockError) return res.status(statusForErrorCode(error.code)).json(error.toEnvelope());
    if (isDomainError(error)) return res.status(statusForErrorCode(error.code)).json(error.toEnvelope());
    if (error instanceof TransferRoleError) return res.status(403).json({ message: error.message });
    if (error instanceof TransferValidationError || error instanceof TransferExpiryBlockedError) {
      return res.status(error instanceof TransferExpiryBlockedError ? 409 : 400).json({ message: error.message });
    }
    return res.status(403).json({ message: error instanceof Error ? error.message : 'Invalid transfer payload' });
  }
});

// ---- Post-Week-20 route extraction: the Transfer edit / delete / status routes moved here from core.ts.
// Handler bodies are unchanged. inactiveItemMessage is a 9-line copy of core.ts's local helper (it is
// still used there by other routes), same rationale as accessContext above.
function inactiveItemMessage(itemIds: string[]): string | null {
  const catalog = listItems();
  for (const id of itemIds) {
    const item = catalog.find((entry) => entry.id === id);
    if (item && !isOperationalItem(item)) {
      return `Item ${item.code} is ${String(item.status).toLowerCase()} and cannot be used in new transactions.`;
    }
  }
  return null;
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

const EDITABLE_TRANSFER_STATUSES = new Set<TransferRecord['status']>(['DRAFT', 'SUBMITTED', 'REQUESTED']);

function canModifyTransfer(context: AccessContext, userId: string, transfer: TransferRecord): boolean {
  if (!canCreateTransfer(context.role) || !EDITABLE_TRANSFER_STATUSES.has(transfer.status)) return false;
  if (!canAccessLocation(context, transfer.sourceLocationId) && !canAccessLocation(context, transfer.destinationLocationId)) return false;
  return context.role !== 'STORE_USER' || transfer.requestedBy === userId;
}

router.patch('/transfers/:transferId', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const transferId = firstParam(req.params.transferId);
  const current = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!current) return res.status(404).json({ message: 'Transfer was not found.' });
  if (!canModifyTransfer(context, req.user!.id, current)) return res.status(403).json({ message: 'Only an editable transfer request can be changed by its requester or a transfer manager.' });
  if (activeCartons(listTransferCartons(current.id)).length) return res.status(409).json({ message: 'Packing has started, so this transfer can no longer be edited.' });

  try {
    const input = req.body as TransferInput;
    if (!canAccessLocation(context, input.sourceLocationId) || !canAccessLocation(context, input.destinationLocationId)) {
      return res.status(403).json({ message: 'Transfer location access denied.' });
    }
    if (context.role === 'STORE_USER') {
      const destination = listLocations().find((location) => location.id === input.destinationLocationId);
      if (input.sourceLocationId !== current.sourceLocationId || destination?.type !== 'warehouse') {
        return res.status(400).json({ message: 'Store users can only edit their request to the same source branch and a warehouse destination.' });
      }
    }
    const cartonCount = parseCartonCount(input.cartonCount);
    const validated = validateTransferRequest(context.role, { ...input, cartonCount });
    const inactiveTransferItem = inactiveItemMessage(validated.lines.map((line) => line.itemId));
    if (inactiveTransferItem) return res.status(400).json({ message: inactiveTransferItem });
    const invalidLot = validated.lines.find((line) => !listItems().find((item) => item.id === line.itemId)?.lots.some((lot) => lot.id === line.lotId));
    if (invalidLot) return res.status(400).json({ message: 'Each transfer lot must belong to its selected item.' });
    if (getActiveWorkflow(req.companyId ?? DEFAULT_COMPANY_ID).expiryBlocking) {
      const blocked = validated.lines.find((line) => {
        const lot = listItems().find((item) => item.id === line.itemId)?.lots.find((entry) => entry.id === line.lotId);
        return lot && ((lot.status && lot.status !== 'AVAILABLE') || Boolean(lot.expiryDate && new Date(lot.expiryDate).getTime() < Date.now()));
      });
      if (blocked) return res.status(409).json({ message: 'Expired or quarantined lots cannot be transferred while expiry blocking is on.' });
    }
    const next: TransferRecord = { ...current, sourceLocationId: validated.sourceLocationId, destinationLocationId: validated.destinationLocationId, lines: validated.lines, cartonCount, notes: validated.notes };
    await persistTransferReplacement(current, next, req.companyId ?? DEFAULT_COMPANY_ID);
    const updated = replaceTransferRecord(current.id, next);
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_EDITED', entityType: 'Transfer', entityId: current.id }));
    return res.json({ success: true, transfer: updated });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to edit transfer.' });
  }
});

router.delete('/transfers/:transferId', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  if (!canModifyTransfer(context, req.user!.id, transfer)) return res.status(403).json({ message: 'Only an editable transfer request can be deleted by its requester or a transfer manager.' });
  if (activeCartons(listTransferCartons(transfer.id)).length) return res.status(409).json({ message: 'Packing has started, so this transfer cannot be deleted.' });
  try {
    await persistTransferDeletion(transfer, req.companyId ?? DEFAULT_COMPANY_ID);
    removeTransferRecord(transfer.id);
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_DELETED', entityType: 'Transfer', entityId: transfer.id }));
    return res.json({ success: true, transferId: transfer.id });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to delete transfer.' });
  }
});

router.patch('/transfers/:transferId/status', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  const nextStatus = req.body.status as TransferRecord['status'];

  if (!transfer) {
    return res.status(404).json({ message: 'Transfer was not found.' });
  }

  const validStatuses = ['SUBMITTED', 'DRAFT', 'PENDING_PICK', 'REQUESTED', 'PICKING', 'PARTIAL', 'PICKED', 'READY_FOR_ADMIN', 'CONFIRMED', 'IN_TRANSIT', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED'];
  if (!validStatuses.includes(nextStatus)) {
    return res.status(400).json({ message: 'Invalid transfer status.' });
  }

  if (!canAccessLocation(context, transfer.sourceLocationId)
    && !canAccessLocation(context, transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Transfer location access denied.' });
  }

  // Packing that was started must be finished (every line in a sealed carton) before the goods leave.
  if (nextStatus === 'DISPATCHED' && !transfer.packing && activeCartons(listTransferCartons(transfer.id)).length > 0) {
    return res.status(409).json({ message: 'Packing was started for this transfer. Complete it before dispatching.' });
  }

  try {
    validateTransferStatusChange(context.role, transfer.status, nextStatus);
    const wasTerminal = (TERMINAL_TRANSFER_STATUSES as readonly string[]).includes(transfer.status);
    const updated = updateTransferStatus(transfer.id, nextStatus);
    await persistTransferStatus(updated, {
      id: req.user!.id,
      role: context.role,
      companyId: req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID,
    });
    // Release the request-time reservation the first time this transfer
    // reaches a terminal state (CONFIRMED is released separately at the
    // dedicated /confirm endpoint, alongside the actual stock decrement).
    if (!wasTerminal && (TERMINAL_TRANSFER_STATUSES as readonly string[]).includes(nextStatus) && nextStatus !== 'CONFIRMED') {
      void releaseReservedStock(transfer.lines.map((line) => ({
        itemId: line.itemId, lotId: line.lotId, locationId: transfer.sourceLocationId, quantity: line.quantity,
      })));
    }
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: `TRANSFER_${nextStatus}`,
      entityType: 'Transfer',
      entityId: updated.id,
    }));
    void emitTransferUpdated(updated);
    return res.json({ success: true, transfer: updated });
  } catch (error) {
    return res.status(403).json({ message: error instanceof Error ? error.message : 'Transfer status change denied.' });
  }
});


// File-local copies of three small core.ts helpers (still used there by other routes), same rationale as
// accessContext above.
const isOperationalAdmin = (role: string) => role === 'ADMIN' || role === 'ADMIN_USER';
function tenantContext(req: Request): TenantContext {
  return {
    companyId: req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID,
    tenantId: DEFAULT_TENANT_ID,
    userId: req.user!.id,
    role: req.user!.role as TenantContext['role'],
  };
}
function xmlEscape(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

// ---- Post-Week-20 route extraction: picker, confirm, export and receive routes moved here from core.ts.
// Handler bodies are unchanged.
router.get('/picker/transfers/:transferId', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role) || !canAccessLocation(context, transfer.sourceLocationId)) return res.status(403).json({ message: 'Picker access denied.' });
  const ledger = listStockLedgerForLocation(transfer.sourceLocationId);
  const itemsById = new Map(listItems().map((item) => [item.id, item]));
  const slips = await savedPickSlips(transferId);
  const picked = new Map<string, number>();
  for (const slip of slips) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
    const key = `${line.itemId}|${line.lotId}`;
    picked.set(key, (picked.get(key) ?? 0) + Number(line.quantity ?? 0));
  }
  const lines = transfer.lines.map((line, index) => {
    const item = itemsById.get(line.itemId);
    const lot = item?.lots.find((entry) => entry.id === line.lotId);
    const pickedQty = picked.get(`${line.itemId}|${line.lotId}`) ?? 0;
    return {
      // itemBarcode: the picker scans the physical product barcode printed on the carton, which is
      // a different value from the internal SKU code (itemCode) - the app only matched against the
      // SKU and lot numbers before, so a real barcode scan was rejected as "wrong item" every time.
      lineId: `${transfer.id}:${index}`, itemId: line.itemId, itemCode: item?.code, itemBarcode: item?.barcode, itemName: item?.name,
      unit: item?.unit ?? 'PCS', pickMethod: item?.pickMethod ?? 'LOT_SCAN', lotStatus: lot?.status ?? 'AVAILABLE', requestedQty: line.quantity, pickedQty, remainingQty: Math.max(0, line.quantity - pickedQty),
      lotId: line.lotId, lotNo: lot?.lotNo, expiryDate: lot?.expiryDate,
      lotAvailable: ledger.find((entry) => entry.itemId === line.itemId && entry.lotId === line.lotId)?.onHand ?? 0,
    };
  });
  return res.json({ transfer: { ...transfer, lines }, pickSlips: slips.map((event) => event.metadata) });
});

// Blueprint v4 §15: what a KG pick would take, lot by lot, before it is confirmed.
async function pooledPickState(transfer: TransferRecord, itemId: string) {
  const item = listItems().find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('Item was not found.');
  if (!isPooledPick(item)) throw new Error(`${item.code} is picked by scanning its lot, not by weight.`);
  const requestedTotal = transfer.lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.quantity, 0);
  if (!(requestedTotal > 0)) throw new Error('This item is not part of the transfer.');
  const priorSlips = await savedPickSlips(transfer.id);
  const pickedByLot = new Map<string, number>();
  for (const slip of priorSlips) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
    if (line.itemId === itemId) pickedByLot.set(line.lotId, (pickedByLot.get(line.lotId) ?? 0) + Number(line.quantity ?? 0));
  }
  const pickedTotal = [...pickedByLot.values()].reduce((sum, value) => sum + value, 0);
  const ledger = listStockLedgerForLocation(transfer.sourceLocationId);
  const lots = item.lots.map((lot) => ({
    lotId: lot.id, lotNo: lot.lotNo, expiryDate: lot.expiryDate, status: lot.status,
    available: Math.max(0, (ledger.find((entry) => entry.itemId === itemId && entry.lotId === lot.id)?.onHand ?? 0) - (pickedByLot.get(lot.id) ?? 0)),
  }));
  return { item, remaining: Math.max(0, Math.round((requestedTotal - pickedTotal) * 1000) / 1000), lots };
}

router.post('/picker/transfers/:transferId/allocation-preview', async (req: Request, res: Response) => {
  const transfer = findTransferForCompany(firstParam(req.params.transferId), req.companyId ?? DEFAULT_COMPANY_ID);
  const context = accessContext(req.user!);
  if (!transfer || !['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role) || !canAccessLocation(context, transfer.sourceLocationId)) return res.status(403).json({ message: 'Picker task is outside the assigned scope.' });
  try {
    const quantity = Number(req.body?.quantity);
    const state = await pooledPickState(transfer, String(req.body?.itemId ?? ''));
    if (Number.isFinite(quantity) && quantity > state.remaining + 1e-8) throw new Error(`Only ${state.remaining} is still to be picked for this item.`);
    const { allocations, shortfall } = allocatePick({ requested: quantity, lots: state.lots, strategy: state.item.allocationStrategy ?? 'FEFO' });
    return res.json({ itemId: state.item.id, unit: state.item.unit ?? 'KG', requested: quantity, remaining: state.remaining, strategy: state.item.allocationStrategy ?? 'FEFO', allocations, shortfall });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview this pick.' });
  }
});

router.post('/picker/transfers/:transferId/pick-slips', async (req: Request, res: Response) => {
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  const context = accessContext(req.user!);
  if (!transfer || context.role !== 'WAREHOUSE_PICKER' || !canAccessLocation(context, transfer.sourceLocationId)) return res.status(403).json({ message: 'Picker task is outside the assigned scope.' });
  const prior = await savedPickSlips(transferId);
  // Retry-safe (blueprint §38): the same request id returns the slip it already saved.
  const requestId = typeof req.body.requestId === 'string' ? req.body.requestId.trim().slice(0, 191) : '';
  if (requestId) {
    const saved = prior.find((event) => event.metadata?.requestId === requestId && event.metadata?.pickerId === req.user!.id);
    if (saved) return res.status(200).json({ message: 'This pick slip was already saved.', duplicate: true, pickSlip: saved.metadata, transfer });
  }
  if (!['PENDING_PICK', 'REQUESTED', 'PICKING', 'PARTIAL'].includes(transfer.status)) return res.status(400).json({ message: `Transfer cannot be picked while ${transfer.status}.` });
  let lines: any[] = Array.isArray(req.body.lines) ? req.body.lines : [];
  const exceptions = Array.isArray(req.body.exceptions) ? req.body.exceptions : [];
  if (!lines.length && !exceptions.length) return res.status(400).json({ message: 'At least one picked line or exception is required.' });
  const itemMap = new Map(listItems().map((item) => [item.id, item]));
  const ledger = listStockLedgerForLocation(transfer.sourceLocationId);
  const priorPicked = new Map<string, number>();
  for (const slip of prior) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
    const key = `${line.itemId}|${line.lotId}`; priorPicked.set(key, (priorPicked.get(key) ?? 0) + Number(line.quantity ?? 0));
  }
  try {
    // A KG line carries only item + weight: the server chooses the lots (FIFO/FEFO), the picker never splits them.
    const expanded: any[] = [];
    for (const line of lines) {
      const item = itemMap.get(line.itemId);
      if (item && isPooledPick(item) && !line.lotId) {
        const state = await pooledPickState(transfer, line.itemId);
        const pending = expanded.filter((row) => row.itemId === line.itemId).reduce((sum, row) => sum + row.quantity, 0);
        const { allocations, shortfall } = allocatePick({
          requested: Number(line.quantity), strategy: item.allocationStrategy ?? 'FEFO',
          lots: state.lots.map((lot) => ({ ...lot, available: Math.max(0, lot.available - expanded.filter((row) => row.lotId === lot.lotId).reduce((sum, row) => sum + row.quantity, 0)) })),
        });
        if (shortfall > 0) throw new Error(`Only ${Math.round((Number(line.quantity) - shortfall) * 1000) / 1000} of ${item.code} is available in pickable lots. Report it as No Stock or pick less.`);
        if (pending + Number(line.quantity) > state.remaining + 1e-8) throw new Error(`${item.code} exceeds remaining requested quantity.`);
        for (const allocation of allocations) expanded.push({ itemId: line.itemId, lotId: allocation.lotId, quantity: allocation.quantity, inputMethod: 'MANUAL', allocated: true });
      } else {
        expanded.push(line);
      }
    }
    lines = expanded;

    const runningLot = new Map(priorPicked);
    const runningItem = new Map<string, number>();
    for (const [key, quantity] of priorPicked) runningItem.set(key.split('|')[0], (runningItem.get(key.split('|')[0]) ?? 0) + quantity);
    for (const line of lines) {
      const requested = transfer.lines.find((entry) => entry.itemId === line.itemId && entry.lotId === line.lotId);
      const item = itemMap.get(line.itemId);
      const lot = item?.lots.find((entry) => entry.id === line.lotId);
      const pooled = Boolean(item && isPooledPick(item));
      if (!item || !lot || (!requested && !pooled)) throw new Error('Picked item/lot is not part of this transfer.');
      const quantity = Number(line.quantity);
      validatePickInput({ unit: item.unit, quantity, inputMethod: line.inputMethod, scanCode: line.scanCode, itemCode: item.code, lotNo: lot.lotNo });
      const lotKey = `${line.itemId}|${line.lotId}`;
      const alreadyLot = runningLot.get(lotKey) ?? 0;
      if (pooled) {
        const total = transfer.lines.filter((entry) => entry.itemId === line.itemId).reduce((sum, entry) => sum + entry.quantity, 0);
        if ((runningItem.get(line.itemId) ?? 0) + quantity > total + 1e-8) throw new Error(`${item.code} exceeds remaining requested quantity.`);
      } else if (alreadyLot + quantity > requested!.quantity + 1e-8) {
        throw new Error(`${item.code}/${lot.lotNo} exceeds remaining requested quantity.`);
      }
      const onHand = ledger.find((entry) => entry.itemId === line.itemId && entry.lotId === line.lotId)?.onHand ?? 0;
      // Blueprint §15: never a zero, blocked or expired lot - and stock already picked on this transfer is spoken for.
      if (!isPickableLot({ status: lot.status, available: onHand - alreadyLot, expiryDate: lot.expiryDate })) {
        throw new Error(`${item.code}/${lot.lotNo} cannot be picked: it is blocked, expired or has no stock left.`);
      }
      if (quantity > onHand - alreadyLot + 1e-8) throw new Error(`${item.code}/${lot.lotNo} exceeds available stock.`);
      runningLot.set(lotKey, alreadyLot + quantity);
      runningItem.set(line.itemId, (runningItem.get(line.itemId) ?? 0) + quantity);
    }
    for (const exception of exceptions) {
      if (!PICK_EXCEPTION_REASONS.includes(exception.reason)) throw new Error('Exception reason must be No Stock, Wrong Item or Damaged Item.');
      if (!Number.isFinite(Number(exception.quantity)) || Number(exception.quantity) <= 0) throw new Error('Exception quantity must be greater than zero.');
    }
    const slipId = `pick-${Math.random().toString(36).slice(2, 10)}`;
    const metadata = { id: slipId, requestId: requestId || undefined, pickerId: req.user!.id, startedAt: req.body.startedAt ?? new Date().toISOString(), completedAt: new Date().toISOString(), lines: lines.map((line: any) => ({ ...line, quantity: Number(line.quantity) })), exceptions: exceptions.map((entry: any) => ({ ...entry, quantity: Number(entry.quantity), recordedAt: new Date().toISOString() })) };
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'PICK_SLIP_SAVED', entityType: 'Transfer', entityId: transfer.id, metadata }));

    // Blueprint WF-12 (Warehouse Exception): a picker-flagged No Stock,
    // Wrong Item or Damaged Item exception opens an owned Exception Inbox
    // case for supervisor resolution instead of silently dropping the line.
    const PICK_EXCEPTION_TYPE: Record<string, 'MISSING_STOCK' | 'WRONG_ITEM' | 'DAMAGE'> = {
      NO_STOCK: 'MISSING_STOCK', WRONG_ITEM: 'WRONG_ITEM', DAMAGED_ITEM: 'DAMAGE',
      'No Stock': 'MISSING_STOCK', 'Wrong Item': 'WRONG_ITEM', 'Damaged Item': 'DAMAGE',
    };
    for (const exception of exceptions) {
      const item = itemMap.get(exception.itemId);
      const itemLabel = item ? `${item.code} - ${item.name}` : exception.itemId ?? 'item';
      void createExceptionCase({
        type: PICK_EXCEPTION_TYPE[exception.reason] ?? 'TRANSFER_DISCREPANCY',
        title: `${String(exception.reason).replaceAll('_', ' ').toLowerCase()}: ${itemLabel}`,
        description: `Reported while picking transfer ${transfer.id}.`,
        itemId: exception.itemId ?? null, lotId: exception.lotId ?? null, locationId: transfer.sourceLocationId,
        quantity: Number(exception.quantity) || null, sourceDocument: transfer.id,
        reportedById: req.user!.id,
        companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      });
    }

    const nextStatus: TransferRecord['status'] = req.body.finished ? 'READY_FOR_ADMIN' : (lines.length ? 'PARTIAL' : 'PICKING');
    const updated = updateTransferStatus(transfer.id, nextStatus);
    await persistTransferStatus(updated, {
      id: req.user!.id,
      role: context.role,
      companyId: req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID,
    });
    void emitTransferUpdated(updated);
    return res.status(201).json({ message: `Pick slip ${slipId} saved.`, pickSlip: metadata, transfer: updated });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save pick slip.' });
  }
});

router.post('/transfers/:transferId/confirm', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Only admins can confirm transfer-out.' });
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  if (!['READY_FOR_ADMIN', 'PARTIAL'].includes(transfer.status)) return res.status(400).json({ message: `Transfer must be ready for admin review, not ${transfer.status}.` });
  const allocations = new Map<string, { itemId: string; lotId: string; locationId: string; quantity: number }>();
  for (const slip of await savedPickSlips(transferId)) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
    const key = `${line.itemId}|${line.lotId}`;
    const existing = allocations.get(key) ?? { itemId: line.itemId, lotId: line.lotId, locationId: transfer.sourceLocationId, quantity: 0 };
    existing.quantity += Number(line.quantity ?? 0); allocations.set(key, existing);
  }
  if (!allocations.size) return res.status(400).json({ message: 'No accepted pick quantities are available to confirm.' });

  // Blueprint §16.2: "transfer > ₹1 lakh -> regional manager approval."
  // Gate before touching stock - a confirmed allocation's total value
  // decides whether a configured ApprovalRule blocks this attempt.
  const totalValue = (await Promise.all(
    [...allocations.values()].map((allocation) => estimateValueAtRisk(tenantContext(req), allocation.itemId, allocation.quantity)),
  )).reduce((sum, value) => sum + (value ?? 0), 0);
  const sourceLocation = await prisma.location.findUnique({ where: { id: transfer.sourceLocationId }, select: { branchId: true } }).catch(() => null);
  const gate = await checkApprovalGate({
    triggerType: 'TRANSFER_CONFIRM', entityType: 'Transfer', entityId: transfer.id,
    branchId: sourceLocation?.branchId ?? null, value: totalValue, requestedById: req.user!.id,
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
  });
  if (gate.blocked) return res.status(409).json({ message: gate.reason, approvalRequestId: gate.requestId, requiredApproverRole: gate.requiredApproverRole });

  try {
    await persistConfirmedPickAllocations(transfer.id, [...allocations.values()], { companyId: req.companyId ?? DEFAULT_COMPANY_ID, tenantId: DEFAULT_TENANT_ID, userId: req.user!.id, role: req.user!.role as Role });
    for (const allocation of allocations.values()) adjustStockLedger(allocation.itemId, allocation.lotId, allocation.locationId, -allocation.quantity);
    const updated = updateTransferStatus(transfer.id, 'CONFIRMED');
    // Stock has just physically left the source (decremented above); the
    // request-time reservation for this transfer's full original quantity
    // is no longer needed, picked-in-full or not.
    void releaseReservedStock(transfer.lines.map((line) => ({
      itemId: line.itemId, lotId: line.lotId, locationId: transfer.sourceLocationId, quantity: line.quantity,
    })));
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_CONFIRMED', entityType: 'Transfer', entityId: transfer.id, metadata: { allocations: [...allocations.values()] } }));
    void emitTransferUpdated(updated);
    return res.json({ message: 'Transfer confirmed and lot-level stock deducted.', transfer: updated });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to confirm transfer.' });
  }
});

router.get('/transfers/:transferId/export.xls', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Transfer export is restricted to admins and auditors.' });
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!transfer) return res.status(404).json({ message: 'Transfer was not found.' });
  const itemMap = new Map(listItems().map((item) => [item.id, item]));
  const slips = await savedPickSlips(transfer.id);
  const picked = new Map<string, number>();
  const exceptionMap = new Map<string, string[]>();
  for (const slip of slips) {
    for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
      const key = `${line.itemId}|${line.lotId}`;
      picked.set(key, (picked.get(key) ?? 0) + Number(line.quantity ?? 0));
    }
    for (const exception of ((slip.metadata?.exceptions as any[]) ?? [])) {
      const key = `${exception.itemId}|${exception.lotId}`;
      const label = `${exception.reason} (${exception.quantity})${exception.note ? ` - ${exception.note}` : ''}`;
      exceptionMap.set(key, [...(exceptionMap.get(key) ?? []), label]);
    }
  }
  const headers = ['Transfer ID', 'Status', 'Source', 'Destination', 'Item Code', 'Item Name', 'Unit', 'Requested Qty', 'Picked Qty', 'Lot', 'Expiry Date', 'Exceptions'];
  const rows = transfer.lines.map((line) => {
    const item = itemMap.get(line.itemId); const lot = item?.lots.find((entry) => entry.id === line.lotId); const key = `${line.itemId}|${line.lotId}`;
    return [transfer.id, transfer.status, transfer.sourceLocationId, transfer.destinationLocationId, item?.code, item?.name, item?.unit, line.quantity, picked.get(key) ?? 0, lot?.lotNo, lot?.expiryDate, (exceptionMap.get(key) ?? []).join('; ')];
  });
  const xmlRows = [headers, ...rows].map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="${typeof cell === 'number' ? 'Number' : 'String'}">${xmlEscape(cell)}</Data></Cell>`).join('')}</Row>`).join('');
  const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Transfer"><Table>${xmlRows}</Table></Worksheet></Workbook>`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${transfer.id}-pick-report.xls"`);
  return res.send(workbook);
});

router.post('/transfers/:transferId/receive', async (req: Request, res: Response) => {
  if (!canReceiveTransfer(req.user!.role)) return res.status(403).json({ message: 'Only operational admins and destination store users can receive transfers.' });
  const transferId = firstParam(req.params.transferId);
  const transfer = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!transfer) return res.status(404).json({ message: 'Transfer not found.' });
  if (!canAccessLocation(accessContext(req.user!), transfer.destinationLocationId)) {
    return res.status(403).json({ message: 'Receiving is limited to the assigned destination.' });
  }

  const requestId = typeof req.body.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!requestId || requestId.length > 191) return res.status(400).json({ message: 'A valid requestId is required for retry-safe receiving.' });

  // A retry (client timeout, offline outbox) of a receipt that already went
  // through answers with the recorded result - before the status gate, because
  // that receipt may itself have completed the transfer.
  const prior = await findReceiptByRequestId(requestId).catch(() => null);
  if (prior) {
    if (prior.transferId !== transferId) return res.status(409).json({ message: 'This requestId was already used for a different transfer.' });
    return res.json({
      success: true, duplicate: true, transfer,
      receipt: { requestId, receiptId: prior.receiptId, transferId, receivedAt: prior.receivedAt, receivedBy: prior.receivedBy, receivedQty: prior.receivedQty, damagedQty: prior.damagedQty, shortageQty: prior.shortageQty, excessQty: prior.excessQty, status: prior.status, notes: prior.notes ?? '' },
    });
  }
  if (!isReceivableStatus(transfer.status)) {
    return res.status(400).json({ message: 'Only dispatched, in-transit or partially received transfers can be received.' });
  }
  // The same request twice at once must not both post: the second waits for the client's next retry.
  if (!beginReceiptRequest(requestId)) return res.status(409).json({ message: 'This receipt is already being processed. Retry in a moment.' });
  try {
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 4000) : '';
  let receiptLines: ReceiptLineInput[];
  if (Array.isArray(req.body.lines)) {
    receiptLines = req.body.lines.map((line: any) => ({
      lineId: typeof line.lineId === 'string' ? line.lineId : undefined,
      itemId: String(line.itemId ?? ''),
      lotId: String(line.lotId ?? ''),
      receivedQty: Number(line.receivedQty),
      damagedQty: Number(line.damagedQty ?? 0),
      shortageQty: Number(line.shortageQty ?? 0),
      excessQty: Number(line.excessQty ?? 0),
    }));
  } else if (transfer.lines.length === 1) {
    receiptLines = [{
      itemId: transfer.lines[0].itemId,
      lotId: transfer.lines[0].lotId,
      receivedQty: Number(req.body.receivedQty),
      damagedQty: Number(req.body.damagedQty ?? 0),
      shortageQty: Number(req.body.shortageQty ?? 0),
      excessQty: Number(req.body.excessQty ?? 0),
    }];
  } else {
    return res.status(400).json({ message: 'Multi-lot transfers require a separate receipt line for every item and lot.' });
  }

  const damagedLines = receiptLines.filter((line) => line.damagedQty > 0);
  if (damagedLines.length > 0) {
    const destinationLocation = await prisma.location.findUnique({ where: { id: transfer.destinationLocationId }, select: { branchId: true } }).catch(() => null);
    for (const line of damagedLines) {
      const gate = await requireEvidenceForDamage(tenantContext(req), {
        transferId: transfer.id, triggerType: 'TRANSFER_RECEIVE_DAMAGE', itemId: line.itemId,
        branchId: destinationLocation?.branchId ?? null, damagedQty: line.damagedQty,
      });
      if (gate.blocked) return res.status(400).json({ message: gate.reason });
    }
  }

  {
    const { listMemoryQcTemplates, listMemoryQcInspections } = await import('../lib/qc-inspection.js');
    const templates = databaseEnabled
      ? await prisma.qcChecklistTemplate.findMany({ where: { active: true, createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } } }).catch(() => listMemoryQcTemplates().filter((row) => row.active))
      : listMemoryQcTemplates().filter((row) => row.active);
    const inspections = databaseEnabled
      ? await prisma.qcInspection.findMany({ where: { sourceDocument: transferId, inspectedBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } } }).catch(() => listMemoryQcInspections())
      : listMemoryQcInspections().filter((row) => row.sourceDocument === transferId);
    const bodyInspections = Array.isArray(req.body.qcInspections) ? req.body.qcInspections : [];
    const itemsById = new Map(listItems().map((item) => [item.id, item]));
    const qc = assertReceiptQcComplete(
      receiptLines.map((line) => ({
        lineId: line.lineId,
        itemId: line.itemId,
        itemCategory: itemsById.get(line.itemId)?.category ?? null,
        receivedQty: line.receivedQty,
        hasInspection: inspections.some((inspection) => inspection.itemId === line.itemId && (inspection.sourceLineId === line.lineId || !line.lineId))
          || bodyInspections.some((inspection: { itemId?: string; lineId?: string }) => inspection.itemId === line.itemId || (line.lineId && inspection.lineId === line.lineId)),
      })),
      templates,
    );
    if (qc.ok === false) return res.status(400).json({ message: qc.message, itemId: qc.itemId, lineId: qc.lineId, code: 'QC_REQUIRED' });
    // Blueprint v4 §25: an inspection that failed sends the goods to quarantine
    // (the QC_FAIL exception case already exists), never to sellable stock.
    const recorded: InspectionLike[] = [
      ...(inspections as unknown as InspectionLike[]),
      ...bodyInspections.map((entry: { itemId?: string; lineId?: string; results?: Record<string, QcCheckResult> }) => ({ itemId: entry.itemId ?? null, sourceLineId: entry.lineId ?? null, results: entry.results ?? null })),
    ];
    receiptLines = quarantineFailedLines(receiptLines, (line) => verdictForLine(recorded, { itemId: line.itemId, lineId: line.lineId })).lines;
  }

  try {
    const persisted = await persistTransferReceipt({
      requestId, transferId, destinationLocationId: transfer.destinationLocationId,
      receivedById: req.user!.id, notes, lines: receiptLines,
      tenant: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, tenantId: DEFAULT_TENANT_ID, userId: req.user!.id, role: req.user!.role as Role },
    });

    let status: TransferRecord['status'];
    let summary: { receivedQty: number; damagedQty: number; shortageQty: number; excessQty: number; complete?: boolean; hasDiscrepancy?: boolean };
    if (persisted) {
      status = persisted.status;
      summary = persisted;
      // Mirror committed database state only after the transaction succeeds.
      updateTransferStatus(transfer.id, status);
      updateTransferReceiptProgress(transfer.id, persisted.lines.map((line) => ({
        itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty),
        receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty), shortageQty: Number(line.shortageQty),
      })));
      if (!persisted.duplicate) for (const line of receiptLines) {
        if (line.receivedQty > 0) adjustStockLedger(line.itemId, line.lotId, transfer.destinationLocationId, line.receivedQty);
        if (line.damagedQty > 0) adjustQuarantineLedger(line.itemId, line.lotId, transfer.destinationLocationId, line.damagedQty);
        if (Number(line.excessQty ?? 0) > 0) adjustQuarantineLedger(line.itemId, line.lotId, transfer.destinationLocationId, Number(line.excessQty));
      }
    } else {
      summary = validateReceiptLines(transfer.lines, receiptLines);
      status = summary.complete && !summary.hasDiscrepancy ? 'RECEIVED' : 'PARTIAL_RECEIVED';
      updateTransferStatus(transfer.id, status);
      const nextLines = transfer.lines.map((line) => {
        const input = receiptLines.find((candidate) => candidate.itemId === line.itemId && candidate.lotId === line.lotId);
        return {
          ...line,
          receivedQty: Number(line.receivedQty ?? 0) + Number(input?.receivedQty ?? 0),
          damagedQty: Number(line.damagedQty ?? 0) + Number(input?.damagedQty ?? 0),
          shortageQty: Number(line.shortageQty ?? 0) + Number(input?.shortageQty ?? 0),
          excessQty: Number(line.excessQty ?? 0) + Number(input?.excessQty ?? 0),
        };
      });
      updateTransferReceiptProgress(transfer.id, nextLines);
      for (const input of receiptLines) {
        if (input.receivedQty > 0) adjustStockLedger(input.itemId, input.lotId, transfer.destinationLocationId, input.receivedQty);
        if (input.damagedQty > 0) adjustQuarantineLedger(input.itemId, input.lotId, transfer.destinationLocationId, input.damagedQty);
        if (Number(input.excessQty ?? 0) > 0) adjustQuarantineLedger(input.itemId, input.lotId, transfer.destinationLocationId, Number(input.excessQty));
      }
    }

    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role,
      action: status === 'RECEIVED' ? 'TRANSFER_RECEIVED' : 'TRANSFER_PARTIALLY_RECEIVED',
      entityType: 'Transfer', entityId: transferId,
      metadata: { requestId, receivedQty: summary.receivedQty, damagedQty: summary.damagedQty, shortageQty: summary.shortageQty, excessQty: summary.excessQty, lines: receiptLines, duplicate: persisted?.duplicate ?? false },
    }));

    // Blueprint Module H: a damaged or short receiving line is a discrepancy
    // case, not an invisible balance correction. Open an owned Exception
    // Inbox case per affected line so QC/quarantine disposition is tracked
    // to closure. Best-effort only - never fail a successful receipt.
    if (!persisted?.duplicate) {
      for (const line of receiptLines) {
        const item = listItems().find((candidate) => candidate.id === line.itemId);
        const itemLabel = item ? `${item.code} - ${item.name}` : line.itemId;
        // Blueprint Module B / section 8.3: good stock that just landed on
        // hand still needs to be physically put away into a bin. Open a
        // putaway task with a suggested bin rather than leaving newly
        // received stock sitting at the dock indefinitely.
        if (line.receivedQty > 0) {
          void createPutawayTask({
            companyId: req.companyId ?? DEFAULT_COMPANY_ID,
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            quantity: line.receivedQty, sourceDocument: transferId, sourceLineId: line.lineId,
          });
          void persistBinStockDelta({
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            binId: STAGING_BIN_ID, qtyDelta: line.receivedQty,
          });
        }
        if (line.damagedQty > 0) {
          void createExceptionCase({
            type: 'DAMAGE',
            title: `Damaged receipt: ${itemLabel}`,
            description: `${line.damagedQty} units received damaged against transfer ${transferId}.`,
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            quantity: line.damagedQty, sourceDocument: transferId, sourceLineId: line.lineId,
            reportedById: req.user!.id,
            companyId: req.companyId ?? DEFAULT_COMPANY_ID,
          });
        }
        if (line.shortageQty > 0) {
          void createExceptionCase({
            type: 'SHORT_RECEIPT',
            title: `Short receipt: ${itemLabel}`,
            description: `${line.shortageQty} units short against transfer ${transferId}.`,
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            quantity: line.shortageQty, sourceDocument: transferId, sourceLineId: line.lineId,
            reportedById: req.user!.id,
            companyId: req.companyId ?? DEFAULT_COMPANY_ID,
          });
        }
        if (Number(line.excessQty ?? 0) > 0) {
          // Blueprint: "excess receipt... never silently absorb." The
          // quantity is already held in quarantine; this case requires an
          // explicit accept (posts to onHand) or reject (returned/destroyed)
          // decision before it can become sellable.
          void createExceptionCase({
            type: 'EXCESS_RECEIPT',
            title: `Excess receipt: ${itemLabel}`,
            description: `${line.excessQty} units received beyond the requested quantity on transfer ${transferId}. Accept or reject.`,
            itemId: line.itemId, lotId: line.lotId || null, locationId: transfer.destinationLocationId,
            quantity: Number(line.excessQty), sourceDocument: transferId, sourceLineId: line.lineId,
            reportedById: req.user!.id,
            companyId: req.companyId ?? DEFAULT_COMPANY_ID,
          });
        }
      }
    }

    const nextTransfer = listTransfers().find((record) => record.id === transferId);
    if (nextTransfer) void emitTransferUpdated(nextTransfer);
    rememberReceipt({
      requestId, transferId, receiptId: persisted?.receiptId, status: status as 'RECEIVED' | 'PARTIAL_RECEIVED', receivedBy: req.user!.id,
      receivedAt: new Date().toISOString(), receivedQty: summary.receivedQty, damagedQty: summary.damagedQty, shortageQty: summary.shortageQty, excessQty: summary.excessQty, notes,
    });
    return res.json({
      success: true, duplicate: persisted?.duplicate ?? false,
      transfer: nextTransfer,
      receipt: { requestId, receiptId: persisted?.receiptId, transferId, receivedAt: new Date().toISOString(), receivedBy: req.user!.id, ...summary, status, notes },
    });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to process receipt.' });
  }
  } finally {
    endReceiptRequest(requestId);
  }
});


export default router;
