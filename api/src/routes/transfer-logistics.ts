import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { recordAudit, listAuditEvents } from '../lib/audit.js';
import { createExceptionCase } from '../lib/exceptions.js';
import { canManageTransferDispatch } from '../lib/transfer-lifecycle.js';
import { validateTransferStatusChange } from '../lib/inventory.js';
import type { Role } from '../lib/inventory.js';
import type { ExpectedPackLine } from '../lib/pack-verification.js';
import { companyOwnsLocation, DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import {
  addTransferCarton, listItems, listTransferCartons, listTransfers, setTransferCartonStatus, setTransferLogistics, updateTransferStatus,
  type TransferRecord,
} from '../lib/repository.js';
import {
  databaseEnabled, loadTransferPickSlips, persistAudit, persistTransferCarton, persistTransferLogistics, persistTransferStatus,
} from '../lib/persistence.js';
import {
  activeCartons, checkCartonLines, isTransitDelayed, nextCartonNumber, packageIdFor, parseDispatchDetails, verifyTransferPacking,
  type CartonLine, type TransferCartonRecord,
} from '../lib/transfer-packing.js';

// Blueprint v4 §16 Packing, §17 Dispatch/Transit. Stock leaves the source at
// /transfers/:id/confirm (existing); packing then re-verifies what is being
// shipped carton by carton, and dispatch records who carries it and when it is
// due. Both are refused until the step before them is genuinely complete.
const router = Router();
const guard = [extractToken, requireAuth, enforcePermissionOverrides];

const PACK_STATUSES = ['READY_FOR_ADMIN', 'PARTIAL', 'CONFIRMED'];
const PACKERS = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER'];

function canAccess(req: Request, locationId: string): boolean {
  const user = req.user!;
  if (user.companyId && !companyOwnsLocation(user.companyId, locationId)) return false;
  if (user.role === 'ADMIN' || user.role === 'ADMIN_USER') return true;
  return (user.locationIds ?? []).includes(locationId);
}

async function pickedLines(transfer: TransferRecord): Promise<ExpectedPackLine[]> {
  const slips = databaseEnabled
    ? await loadTransferPickSlips(transfer.id)
    : listAuditEvents().filter((event) => event.entityType === 'Transfer' && event.entityId === transfer.id && event.action === 'PICK_SLIP_SAVED');
  const byKey = new Map<string, ExpectedPackLine>();
  for (const slip of slips) {
    for (const line of ((slip.metadata?.lines as Array<{ itemId: string; lotId: string; quantity: number }>) ?? [])) {
      const key = `${line.itemId}|${line.lotId}`;
      const current = byKey.get(key) ?? { itemId: line.itemId, lotId: line.lotId, requestedQty: 0 };
      current.requestedQty += Number(line.quantity ?? 0);
      byKey.set(key, current);
    }
  }
  if (byKey.size) return [...byKey.values()].filter((line) => line.requestedQty > 0);
  // No pick slip yet: what was requested is what must go in the cartons.
  return transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity }));
}

function summarize(cartons: TransferCartonRecord[]) {
  return cartons.map((carton) => ({
    id: carton.id, cartonNumber: carton.cartonNumber, packageId: carton.packageId, quantity: carton.quantity,
    weightKg: carton.weightKg, status: carton.status, sealedAt: carton.sealedAt, packedById: carton.packedById, lines: carton.lines,
  }));
}

async function packState(transfer: TransferRecord) {
  const expected = await pickedLines(transfer);
  const cartons = listTransferCartons(transfer.id);
  const verification = verifyTransferPacking(expected, cartons);
  return {
    transferId: transfer.id,
    status: transfer.status,
    expected,
    cartons: summarize(cartons),
    verification,
    packingComplete: Boolean(transfer.packing),
    packing: transfer.packing,
    canComplete: verification.readyToSeal && !transfer.packing,
  };
}

function lookup(req: Request, res: Response): TransferRecord | undefined {
  const transfer = listTransfers().find((record) => record.id === String(req.params.transferId));
  if (!transfer || (!canAccess(req, transfer.sourceLocationId) && !canAccess(req, transfer.destinationLocationId))) {
    res.status(404).json({ message: 'Transfer was not found.' });
    return undefined;
  }
  return transfer;
}

function requirePacker(req: Request, res: Response, transfer: TransferRecord): boolean {
  if (!PACKERS.includes(req.user!.role) || !canAccess(req, transfer.sourceLocationId)) {
    res.status(403).json({ message: 'Only the source branch packing team can pack this transfer.' });
    return false;
  }
  return true;
}

router.get('/transfers/:transferId/pack', ...guard, async (req: Request, res: Response) => {
  const transfer = lookup(req, res);
  if (!transfer) return;
  if (!PACKERS.includes(req.user!.role) && req.user!.role !== 'AUDITOR') return res.status(403).json({ message: 'Packing access denied.' });
  return res.json(await packState(transfer));
});

router.post('/transfers/:transferId/cartons', ...guard, async (req: Request, res: Response) => {
  const transfer = lookup(req, res);
  if (!transfer || !requirePacker(req, res, transfer)) return;
  if (!PACK_STATUSES.includes(transfer.status)) return res.status(409).json({ message: `A transfer in ${transfer.status} cannot be packed.` });
  if (transfer.packing) return res.status(409).json({ message: 'Packing is already complete for this transfer.' });

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim().slice(0, 191) : '';
  if (requestId) {
    const prior = listTransferCartons(transfer.id).find((carton) => carton.requestId === requestId);
    if (prior) return res.json({ success: true, duplicate: true, carton: summarize([prior])[0], ...(await packState(transfer)) });
  }

  const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!rawLines.length) return res.status(400).json({ message: 'Add at least one item to the carton.' });
  const catalog = new Map(listItems().map((item) => [item.id, item]));
  const lines: CartonLine[] = [];
  for (const raw of rawLines as Array<Record<string, unknown>>) {
    const quantity = Number(raw.quantity);
    const itemId = String(raw.itemId ?? '');
    const lotId = String(raw.lotId ?? '');
    if (!itemId || !lotId || !Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ message: 'Every carton line needs an item, a lot and a positive quantity.' });
    }
    const item = catalog.get(itemId);
    if (item && !item.decimalQuantity && item.countMethod !== 'ITEM_WEIGHT' && !Number.isInteger(quantity)) {
      return res.status(400).json({ message: `${item.code} is packed in whole units.` });
    }
    lines.push({ itemId, lotId, quantity: Math.round(quantity * 1000) / 1000 });
  }
  const weightKg = req.body?.weightKg === undefined || req.body.weightKg === '' ? undefined : Number(req.body.weightKg);
  if (weightKg !== undefined && (!Number.isFinite(weightKg) || weightKg <= 0)) return res.status(400).json({ message: 'Carton weight must be a positive number.' });

  const expected = await pickedLines(transfer);
  const existing = listTransferCartons(transfer.id);
  const mismatches = checkCartonLines(expected, existing, lines);
  if (mismatches.length) {
    // "Mismatch creates exception; cannot silently seal."
    void createExceptionCase({
      type: 'TRANSFER_DISCREPANCY',
      title: `Pack mismatch on transfer ${transfer.id}`,
      description: mismatches.map((row) => `${row.itemId}/${row.lotId}: ${row.kind === 'OVER' ? `${row.quantity} packed, only ${row.remaining} left to pack` : `${row.quantity} packed but not on this transfer`}`).join('; '),
      locationId: transfer.sourceLocationId, sourceDocument: transfer.id, reportedById: req.user!.id,
      companyId: req.user!.companyId ?? DEFAULT_COMPANY_ID,
    });
    return res.status(409).json({ message: 'This carton does not match what was picked for the transfer, so it was not sealed. A discrepancy case was opened.', mismatches });
  }

  const number = nextCartonNumber(existing);
  const carton: TransferCartonRecord = {
    id: `carton-${randomUUID()}`, transferId: transfer.id, cartonNumber: String(number), packageId: packageIdFor(transfer.id, number),
    lines, quantity: Math.round(lines.reduce((sum, line) => sum + line.quantity, 0) * 1000) / 1000, weightKg,
    status: 'SEALED', packedById: req.user!.id, sealedAt: new Date().toISOString(), requestId: requestId || undefined,
  };
  addTransferCarton(carton);
  await persistTransferCarton(carton);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_CARTON_SEALED', entityType: 'Transfer', entityId: transfer.id, metadata: { packageId: carton.packageId, quantity: carton.quantity, weightKg } }));
  return res.status(201).json({ success: true, carton: summarize([carton])[0], ...(await packState(transfer)) });
});

router.post('/transfers/:transferId/cartons/:cartonId/void', ...guard, async (req: Request, res: Response) => {
  const transfer = lookup(req, res);
  if (!transfer || !requirePacker(req, res, transfer)) return;
  if (transfer.packing) return res.status(409).json({ message: 'Packing is already complete; it cannot be changed.' });
  const carton = listTransferCartons(transfer.id).find((row) => row.id === String(req.params.cartonId));
  if (!carton) return res.status(404).json({ message: 'Carton was not found.' });
  const voided = setTransferCartonStatus(carton.id, 'VOID')!;
  await persistTransferCarton(voided);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_CARTON_VOIDED', entityType: 'Transfer', entityId: transfer.id, metadata: { packageId: carton.packageId } }));
  return res.json({ success: true, ...(await packState(transfer)) });
});

router.post('/transfers/:transferId/pack/complete', ...guard, async (req: Request, res: Response) => {
  const transfer = lookup(req, res);
  if (!transfer || !requirePacker(req, res, transfer)) return;
  if (!PACK_STATUSES.includes(transfer.status)) return res.status(409).json({ message: `A transfer in ${transfer.status} cannot be packed.` });
  if (transfer.packing) return res.json({ success: true, duplicate: true, ...(await packState(transfer)) });

  const state = await packState(transfer);
  if (!state.verification.readyToSeal) {
    void createExceptionCase({
      type: 'TRANSFER_DISCREPANCY',
      title: `Packing incomplete on transfer ${transfer.id}`,
      description: state.verification.lines.filter((line) => line.status !== 'MATCHED').map((line) => `${line.itemId}/${line.lotId}: packed ${line.scannedQty} of ${line.requestedQty}`).join('; '),
      locationId: transfer.sourceLocationId, sourceDocument: transfer.id, reportedById: req.user!.id,
      companyId: req.user!.companyId ?? DEFAULT_COMPANY_ID,
    });
    return res.status(409).json({ message: 'Every picked line must be fully packed into sealed cartons before packing can be completed.', ...state });
  }
  const cartonCount = activeCartons(listTransferCartons(transfer.id)).length;
  const updated = setTransferLogistics(transfer.id, { cartonCount, packing: { completedAt: new Date().toISOString(), completedById: req.user!.id, cartonCount } });
  await persistTransferLogistics(updated, req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_PACKED', entityType: 'Transfer', entityId: transfer.id, metadata: { cartonCount } }));
  return res.json({ success: true, ...(await packState(updated)) });
});

router.post('/transfers/:transferId/dispatch', ...guard, async (req: Request, res: Response) => {
  const transfer = lookup(req, res);
  if (!transfer) return;
  if (!canManageTransferDispatch(req.user!.role) || !canAccess(req, transfer.sourceLocationId)) {
    return res.status(403).json({ message: 'Only admins and the source branch manager can dispatch a transfer.' });
  }
  if (transfer.dispatch && ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'].includes(transfer.status)) {
    return res.json({ success: true, duplicate: true, transfer });
  }
  if (transfer.status !== 'CONFIRMED') return res.status(409).json({ message: `Confirm the pick and deduct source stock first; this transfer is ${transfer.status}.` });
  if (!transfer.packing) return res.status(409).json({ message: 'Complete packing (every line in a sealed carton) before dispatching.' });
  let details;
  try {
    details = parseDispatchDetails(req.body ?? {});
    validateTransferStatusChange(req.user!.role as Role, transfer.status, 'DISPATCHED');
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid dispatch details.' });
  }
  updateTransferStatus(transfer.id, 'DISPATCHED');
  const updated = setTransferLogistics(transfer.id, { dispatch: { dispatchedAt: new Date().toISOString(), dispatchedById: req.user!.id, ...details } });
  await persistTransferStatus(updated, {
    id: req.user!.id,
    role: req.user!.role as Role,
    companyId: req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID,
  });
  await persistTransferLogistics(updated, req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_DISPATCHED', entityType: 'Transfer', entityId: transfer.id, metadata: { ...details } }));
  return res.json({ success: true, transfer: updated });
});

router.get('/transfers/:transferId/tracking', ...guard, (req: Request, res: Response) => {
  const transfer = lookup(req, res);
  if (!transfer) return;
  const cartons = activeCartons(listTransferCartons(transfer.id));
  return res.json({
    transferId: transfer.id,
    status: transfer.status,
    sourceLocationId: transfer.sourceLocationId,
    destinationLocationId: transfer.destinationLocationId,
    packing: transfer.packing,
    dispatch: transfer.dispatch,
    expectedArrivalAt: transfer.dispatch?.expectedArrivalAt,
    delayed: isTransitDelayed({ status: transfer.status, expectedArrivalAt: transfer.dispatch?.expectedArrivalAt }),
    cartons: cartons.map((carton) => ({ packageId: carton.packageId, quantity: carton.quantity, weightKg: carton.weightKg })),
  });
});

// Blueprint §18: "Scan transfer/carton -> load expected lines". A carton's
// package id (its label / QR) leads to its transfer, for the destination.
router.get('/transfers/by-package/:packageId', ...guard, (req: Request, res: Response) => {
  const wanted = String(req.params.packageId).trim().toLowerCase();
  const carton = listTransferCartons().find((row) => row.status === 'SEALED' && row.packageId.toLowerCase() === wanted);
  const transfer = carton && listTransfers().find((record) => record.id === carton.transferId);
  if (!transfer || (!canAccess(req, transfer.destinationLocationId) && !canAccess(req, transfer.sourceLocationId))) {
    return res.status(404).json({ message: 'No transfer carton matches that code.' });
  }
  return res.json({ transfer, packageId: carton!.packageId });
});

export default router;
