// Week 8: command/query service for the Transfer slice extracted out of
// routes/core.ts (the "god router"). This is the layer the guide asks for
// between a thin route and the domain/repository code: it owns the
// create-transfer workflow (validation, reservation, persistence, audit,
// and rollback-on-failure), so routes/transfers.ts's handler is just
// "parse request, call service, map result to response."
import { validateTransferRequest, canAccessLocation, type TransferInput, type AccessContext } from './inventory.js';
import { canCreateTransfer, parseCartonCount } from './transfer-lifecycle.js';
import { listItems, listLocations } from './repository.js';
import { createTransferRequest, type TransferRequest } from './store.js';
import { createTransferRecord } from './repositories/transfer-repository.js';
import { isOperationalItem } from './item-master.js';
import { getActiveWorkflow } from './industry-packs.js';
import { reserveStockForTransfer, releaseReservedStock, InsufficientStockError } from './reservation.js';
import { recordAudit } from './audit.js';
import { persistAudit, persistTransfer } from './persistence.js';

export class TransferRoleError extends Error {}
export class TransferValidationError extends Error {}
export class TransferExpiryBlockedError extends Error {}

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

export type CreateTransferCommand = {
  context: AccessContext;
  input: TransferInput;
  actorId: string;
  actorRole: string;
  companyId: string;
  requestId?: string;
  traceId?: string;
};

/**
 * Creates a transfer request: validates the payload, blocks expired/
 * quarantined lots when the active workflow requires it, reserves stock
 * (Week 7's atomic reservation primitive) before the transfer row exists so
 * a second concurrent request against the same low-stock lot is rejected
 * here rather than discovering the shortfall later, and releases the
 * reservation if persisting the transfer itself then fails - unchanged
 * behavior from the version of this logic that lived inline in
 * routes/core.ts's `POST /transfers` handler before this week's extraction.
 */
export async function createTransfer(cmd: CreateTransferCommand): Promise<TransferRequest> {
  const { context, input } = cmd;
  if (!canCreateTransfer(context.role)) {
    throw new TransferRoleError('This role cannot create transfer requests.');
  }
  if (context.role === 'BRANCH_MANAGER' && !canAccessLocation(context, input.sourceLocationId)) {
    throw new TransferRoleError('Branch managers can only create transfers from assigned locations.');
  }
  if (context.role === 'STORE_USER') {
    if (!canAccessLocation(context, input.sourceLocationId)) {
      throw new TransferRoleError('Store user can only request from an assigned location.');
    }
    const destination = listLocations().find((location) => location.id === input.destinationLocationId);
    if (destination?.type !== 'warehouse') {
      throw new TransferValidationError('Store transfer destination must be a warehouse.');
    }
  }

  const cartonCount = parseCartonCount(input.cartonCount);
  const validated = validateTransferRequest(context.role, { ...input, cartonCount });
  const inactiveTransferItem = inactiveItemMessage(validated.lines.map((line) => line.itemId));
  if (inactiveTransferItem) throw new TransferValidationError(inactiveTransferItem);

  const workflow = getActiveWorkflow(context.companyId);
  if (workflow.expiryBlocking) {
    const expired = validated.lines.filter((line) => {
      const item = listItems().find((entry) => entry.id === line.itemId);
      const lot = item?.lots.find((entry) => entry.id === line.lotId);
      if (!lot) return false;
      if (lot.status && lot.status !== 'AVAILABLE') return true;
      return Boolean(lot.expiryDate && new Date(lot.expiryDate).getTime() < Date.now());
    });
    if (expired.length) {
      throw new TransferExpiryBlockedError('Expired or quarantined lots cannot be transferred while expiry blocking is on.');
    }
  }

  // Blueprint §7.2/§9: reserve before creating the request so a second
  // concurrent request against the same low-stock lot is rejected here
  // rather than discovering the shortfall later, one pick at a time.
  await reserveStockForTransfer(
    validated.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, locationId: validated.sourceLocationId, quantity: line.quantity })),
    { companyId: cmd.companyId, actorId: cmd.actorId, requestId: cmd.requestId, traceId: cmd.traceId },
  );

  try {
    const saved = createTransferRequest({
      sourceLocationId: validated.sourceLocationId,
      destinationLocationId: validated.destinationLocationId,
      requestedBy: cmd.actorId,
      role: context.role === 'WAREHOUSE_PICKER' || context.role === 'AUDITOR' ? 'ADMIN' : context.role,
      lines: validated.lines,
      cartonCount,
      photos: input.photos,
      notes: input.notes,
    });

    createTransferRecord({
      id: saved.id,
      sourceLocationId: saved.sourceLocationId,
      destinationLocationId: saved.destinationLocationId,
      requestedBy: saved.requestedBy,
      role: saved.role,
      status: saved.status,
      lines: saved.lines,
      cartonCount: saved.cartonCount,
      photos: saved.photos,
      notes: saved.notes,
      createdAt: saved.createdAt,
      companyId: cmd.companyId,
    });
    await persistTransfer(saved, cmd.companyId);
    await persistAudit(recordAudit({
      actorId: cmd.actorId,
      actorRole: cmd.actorRole,
      action: 'TRANSFER_REQUESTED',
      entityType: 'Transfer',
      entityId: saved.id,
    }));

    return saved;
  } catch (error) {
    // The reservation above already committed; do not leave it stranded
    // against a transfer that was never actually created.
    void releaseReservedStock(validated.lines.map((line) => ({
      itemId: line.itemId, lotId: line.lotId, locationId: validated.sourceLocationId, quantity: line.quantity,
    })));
    throw error;
  }
}

export { InsufficientStockError };
