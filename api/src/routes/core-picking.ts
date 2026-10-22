// Picking & replenishment routes for core (Phase 4): extracted
// verbatim from core.ts; the composer mounts these routers at the
// clusters' original registration positions.
import { savedPickSlips } from '../lib/transfer-pick-slips.js';
import { type Request, type Response, Router } from 'express';
import { pickerMayWork } from '../lib/transfer-assignment.js';
import { createHash } from 'node:crypto';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { canAccessLocation, type Role } from '../lib/inventory.js';
import { createTransferRecord, findTransferForCompany, listItems, listStockLedgerForLocation, listTransfers, locations, updateTransferStatus, type TransferRecord } from '../lib/repository.js';
import { emitTransferUpdated } from '../lib/webhook-dispatcher.js';
import { lastKnownBin, sequenceKeyForBin } from '../lib/pick-wave.js';
import { reserveStockForTransfer } from '../lib/reservation.js';
import { buildPickerTask, completePickerTask } from '../lib/picker.js';
import { recordAudit } from '../lib/audit.js';
import { persistAudit, persistTransfer, persistTransferStatus } from '../lib/persistence.js';
import { allocateLots } from '../lib/warehouse-workflow.js';
import { getActiveWorkflow } from '../lib/industry-packs.js';
import { prisma } from '../lib/db.js';
import { buildPickerTasks, listPickableTransfers } from '../lib/picker-tasks.js';
import { accessContext, tenantContext, firstParam, requireAdmin, isOperationalAdmin } from './core-shared.js';

const router = Router();

router.post('/replenishment-actions/transfer', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const sourceLocationId = String(req.body.sourceLocationId ?? '');
  const destinationLocationId = String(req.body.destinationLocationId ?? '');
  const itemId = String(req.body.itemId ?? '');
  const quantity = Number(req.body.quantity);
  const requestId = typeof req.body.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!requestId || requestId.length > 191) return res.status(400).json({ message: 'A valid requestId is required.' });
  if (!sourceLocationId || !destinationLocationId || sourceLocationId === destinationLocationId) return res.status(400).json({ message: 'Distinct source and destination locations are required.' });
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ message: 'Quantity must be positive.' });
  const context = accessContext(req.user!);
  if (!canAccessLocation(context, sourceLocationId) || !canAccessLocation(context, destinationLocationId)) return res.status(403).json({ message: 'Location access denied.' });

  const transferId = `replenishment-${createHash('sha1').update(requestId).digest('hex').slice(0, 24)}`;
  const existing = findTransferForCompany(transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (existing) return res.json({ success: true, duplicate: true, transfer: existing });

  const item = listItems().find((entry) => entry.id === itemId);
  if (!item) return res.status(404).json({ message: 'Item was not found.' });
  const sourceStock = listStockLedgerForLocation(sourceLocationId);
  const lots = item.lots.map((lot) => ({
    lotId: lot.id,
    lotNo: lot.lotNo,
    expiryDate: lot.expiryDate,
    available: sourceStock.find((row) => row.itemId === itemId && row.lotId === lot.id)?.onHand ?? 0,
    status: (lot as any).status ?? 'AVAILABLE',
  }));
  const allocation = allocateLots(lots, quantity, getActiveWorkflow(req.companyId ?? DEFAULT_COMPANY_ID).allocationStrategy);
  if (allocation.shortage > 1e-8) return res.status(409).json({ message: `Source stock changed; ${allocation.shortage} units are no longer available.` });

  const transfer: TransferRecord = {
    id: transferId,
    sourceLocationId,
    destinationLocationId,
    requestedBy: req.user!.id,
    role: req.user!.role as Role,
    status: 'REQUESTED',
    lines: allocation.allocations.map((line) => ({ itemId, lotId: line.lotId, quantity: line.quantity })),
    notes: `Created from replenishment recommendation. Request: ${requestId}`,
    createdAt: new Date().toISOString(),
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
  };
  try {
    await reserveStockForTransfer(transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, locationId: sourceLocationId, quantity: line.quantity })), { companyId: req.companyId ?? DEFAULT_COMPANY_ID });
    // Commit first so a database failure cannot leave a phantom transfer in
    // the process mirror. The deterministic ID makes request retries safe.
    await persistTransfer(transfer, req.companyId ?? DEFAULT_COMPANY_ID);
    createTransferRecord(transfer);
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role,
      action: 'REPLENISHMENT_TRANSFER_CREATED', entityType: 'Transfer', entityId: transfer.id,
      metadata: { requestId, sourceLocationId, destinationLocationId, itemId, quantity, strategy: 'FEFO' },
    }));
    return res.status(201).json({ success: true, duplicate: false, transfer });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to create replenishment transfer.' });
  }
});

// ============================================
// PICKER TASKS
// ============================================

// Database-first slice 9: the task list is built by lib/picker-tasks.ts (Postgres in database mode).
router.get('/picker-tasks', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role)) {
    return res.status(403).json({ message: 'Picker task access denied.' });
  }
  const tasks = buildPickerTasks(context, req.user!.id, await listPickableTransfers(tenantContext(req)));
  return res.json({ tasks });
});

// ============================================
// PICK WAVES (blueprint Module C / section 9.2)
// ============================================

const PICKABLE_TRANSFER_STATUSES = ['REQUESTED', 'PENDING_PICK', 'PICKING', 'PARTIAL'];

router.get('/pick-waves', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role)) {
    return res.status(403).json({ message: 'Pick wave access denied.' });
  }
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (locationId && !canAccessLocation(context, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const scope = context.role === 'ADMIN' || context.role === 'ADMIN_USER'
    ? (locationId ? { locationId } : {})
    : { locationId: { in: context.assignedLocationIds } };
  const waves = await prisma.pickWave.findMany({
    // A pick wave has no company column of its own; it belongs to the company that owns its location. Without this an
    // Admin listing waves with no locationId (scope {}) got every company's waves.
    where: { ...scope, location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID }, ...(status ? { status } : { status: { in: ['OPEN', 'IN_PROGRESS'] } }) },
    include: { location: { select: { id: true, code: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  }).catch(() => []);
  return res.json({ waves });
});

router.post('/pick-waves', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : '';
  const transferIds: string[] = Array.isArray(req.body.transferIds) ? req.body.transferIds.filter((id: unknown) => typeof id === 'string') : [];
  if (!locationId || transferIds.length < 2) {
    return res.status(400).json({ message: 'A location and at least two transfers are required to form a pick wave.' });
  }
  const transfers = listTransfers().filter((transfer) => transferIds.includes(transfer.id));
  if (transfers.length !== transferIds.length) return res.status(404).json({ message: 'One or more transfers were not found.' });
  const invalid = transfers.find((transfer) => transfer.sourceLocationId !== locationId || !PICKABLE_TRANSFER_STATUSES.includes(transfer.status));
  if (invalid) {
    return res.status(409).json({ message: `Transfer ${invalid.id} is not pickable from this location right now (status ${invalid.status}).` });
  }
  try {
    const wave = await prisma.pickWave.create({
      data: { locationId, transferIds, createdById: req.user!.id },
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'PICK_WAVE_CREATED',
      entityType: 'PickWave', entityId: wave.id, metadata: { locationId, transferIds },
    }));
    return res.status(201).json({ wave });
  } catch {
    return res.status(503).json({ message: 'Pick waves are not available on this database yet.' });
  }
});

router.get('/pick-waves/:id', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(context.role)) {
    return res.status(403).json({ message: 'Pick wave access denied.' });
  }
  const wave = await prisma.pickWave.findFirst({
    where: { id: firstParam(req.params.id), location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
    include: { location: { select: { id: true, code: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
  }).catch(() => null);
  if (!wave) return res.status(404).json({ message: 'Pick wave not found.' });
  if (!canAccessLocation(context, wave.locationId)) return res.status(403).json({ message: 'Location access denied.' });

  const transferIds = Array.isArray(wave.transferIds) ? (wave.transferIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
  const transfers = listTransfers().filter((transfer) => transferIds.includes(transfer.id));
  const itemsById = new Map(listItems().map((item) => [item.id, item]));

  // Combine every member transfer's remaining pick quantity by item+lot,
  // keeping a per-destination breakdown so pack/dispatch still segregates
  // by transfer (blueprint: "combine... while keeping destination
  // segregation").
  type Combined = {
    itemId: string; itemCode?: string; itemName?: string; unit?: string;
    lotId: string; lotNo?: string; expiryDate?: string | null;
    totalRemainingQty: number;
    destinations: Array<{ transferId: string; destinationLocationId: string; remainingQty: number }>;
  };
  const combined = new Map<string, Combined>();
  for (const transfer of transfers) {
    const slips = await savedPickSlips(transfer.id);
    const picked = new Map<string, number>();
    for (const slip of slips) for (const line of ((slip.metadata?.lines as any[]) ?? [])) {
      const key = `${line.itemId}|${line.lotId}`;
      picked.set(key, (picked.get(key) ?? 0) + Number(line.quantity ?? 0));
    }
    for (const line of transfer.lines) {
      const remainingQty = Math.max(0, Number(line.quantity) - (picked.get(`${line.itemId}|${line.lotId}`) ?? 0));
      if (remainingQty <= 0) continue;
      const key = `${line.itemId}|${line.lotId}`;
      const item = itemsById.get(line.itemId);
      const lot = item?.lots.find((entry) => entry.id === line.lotId);
      const existing = combined.get(key) ?? {
        itemId: line.itemId, itemCode: item?.code, itemName: item?.name, unit: item?.unit ?? 'PCS',
        lotId: line.lotId, lotNo: lot?.lotNo, expiryDate: lot?.expiryDate, totalRemainingQty: 0, destinations: [],
      };
      existing.totalRemainingQty += remainingQty;
      existing.destinations.push({ transferId: transfer.id, destinationLocationId: transfer.destinationLocationId, remainingQty });
      combined.set(key, existing);
    }
  }

  const linesWithBins = await Promise.all([...combined.values()].map(async (line) => {
    const bin = await lastKnownBin(wave.locationId, line.itemId, line.lotId);
    return { ...line, binCode: bin?.code ?? null, sequenceKey: sequenceKeyForBin(bin) };
  }));
  linesWithBins.sort((a, b) => a.sequenceKey.localeCompare(b.sequenceKey));

  return res.json({
    wave,
    transfers: transfers.map((transfer) => ({ id: transfer.id, status: transfer.status, destinationLocationId: transfer.destinationLocationId })),
    lines: linesWithBins,
  });
});

router.patch('/pick-waves/:id', async (req: Request, res: Response) => {
  const wave = await prisma.pickWave.findFirst({ where: { id: firstParam(req.params.id), location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } } }).catch(() => null);
  if (!wave) return res.status(404).json({ message: 'Pick wave not found.' });
  const context = accessContext(req.user!);
  const isAdmin = context.role === 'ADMIN' || context.role === 'ADMIN_USER';
  const isAssignee = wave.assignedToId === req.user!.id;
  if (!isAdmin && !isAssignee) return res.status(403).json({ message: 'You do not have access to this pick wave.' });

  const data: Record<string, unknown> = {};
  if (isAdmin && req.body.assignedToId !== undefined) {
    // The assignee is joined into GET /pick-waves, so it must be a user of the caller's own company.
    if (req.body.assignedToId) {
      const assignee = await prisma.user.findFirst({ where: { id: String(req.body.assignedToId), companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { id: true } }).catch(() => null);
      if (!assignee) return res.status(404).json({ message: 'Assignee was not found.' });
    }
    data.assignedToId = req.body.assignedToId || null;
  }
  if (req.body.status !== undefined) {
    const validStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(req.body.status)) return res.status(400).json({ message: 'Invalid status.' });
    data.status = req.body.status;
    if (req.body.status === 'IN_PROGRESS' && !wave.startedAt) data.startedAt = new Date();
    if (req.body.status === 'COMPLETED') data.completedAt = new Date();
  }
  if (!Object.keys(data).length) return res.status(400).json({ message: 'No updatable fields were provided.' });
  const updated = await prisma.pickWave.update({ where: { id: wave.id }, data });
  return res.json({ wave: updated });
});

export default router;

export const pickerTasksRouter = Router();
{
  const router = pickerTasksRouter;
// ---------------------------------------------------------------------------
// Picker tasks
// ---------------------------------------------------------------------------

router.post('/picker-tasks', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can assign picker tasks.' });
  }
  try {
    const task = buildPickerTask({
      transferId: req.body.transferId,
      locationId: req.body.locationId,
      lines: req.body.lines,
      assignedPickerId: req.body.assignedPickerId ?? req.user!.id,
      role: 'WAREHOUSE_PICKER',
    });
    return res.status(201).json({ success: true, task });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to build picker task.' });
  }
});

router.post('/picker-tasks/complete', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const transfer = findTransferForCompany(req.body.transferId, req.companyId ?? DEFAULT_COMPANY_ID);
  if (context.role !== 'WAREHOUSE_PICKER' || !transfer || !canAccessLocation(context, transfer.sourceLocationId) || !pickerMayWork(transfer, req.user!.id)) {
    return res.status(403).json({ message: 'Picker task is outside the assigned scope.' });
  }

  try {
    const result = completePickerTask({
      transferId: req.body.transferId,
      pickerId: req.user!.id,
      role: 'WAREHOUSE_PICKER',
      pickedQty: Number(req.body.pickedQty),
    });

    const updated = updateTransferStatus(transfer.id, 'PICKED');
    await persistTransferStatus(updated, {
      id: req.user!.id,
      role: context.role,
      companyId: req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID,
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: 'TRANSFER_PICKED',
      entityType: 'Transfer',
      entityId: updated.id,
    }));
    void emitTransferUpdated(updated);
    return res.json({ success: true, result, transfer: updated });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to complete picker task.' });
  }
});
}
