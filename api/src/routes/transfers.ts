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


export default router;
