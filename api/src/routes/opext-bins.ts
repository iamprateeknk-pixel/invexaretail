// Bin directory, bin transfers, pick-face replenishment, putaway and
// bin-stock routes for operations-extension (Phase 4): extracted
// verbatim from operations-extension.ts; the composer mounts these
// routers at the clusters' original registration positions.
import { decimalsToNumbers } from '../lib/decimal-json.js';
import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { isDomainError, sendError, statusForErrorCode } from '../lib/errors.js';
import { enforceMobilePermit } from '../lib/saas/mobile-offline-permits.js';
import { rememberPersistedAudit } from '../lib/audit.js';
import { sellableQuantity } from '../lib/sellable-stock.js';
import { databaseEnabled } from '../lib/persistence.js';
import { listItems, listStockLedgerForLocation } from '../lib/repository.js';
import { assertPutawayScan, assertGuidedWalkScan } from '../lib/scan-enforcement.js';
import { BinStockShortageError, moveBinStockInTransaction, moveBinStockPersisted, STAGING_BIN_ID, memoryBinStock, listMemoryBins, createMemoryBin } from '../lib/bin-stock.js';
import { assertValidBinMove, BinMoveValidationError } from '../lib/bin-move.js';
import { planPickFaceReplenishment } from '../lib/pick-face-replenishment.js';
import { sequenceKeyForBin, lastKnownBin } from '../lib/pick-wave.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import { listBinStockForLocation, type BinStockRow } from '../lib/repositories/stock-repository.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { canAccessLocation, requireAdmin } from './opext-shared.js';

const router = Router();

// ============================================================================
// BIN DIRECTORY + PUTAWAY (blueprint Module B / sections 6 & 8.3)
// ============================================================================

router.get('/locations/:locationId/bins', async (req, res) => {
  const locationId = req.params.locationId;
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) return res.json({ bins: listMemoryBins(locationId) });
  const bins = await prisma.bin.findMany({ where: { locationId }, orderBy: { code: 'asc' } });
  return res.json({ bins });
});

router.post('/locations/:locationId/bins', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const locationId = req.params.locationId;
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  if (!code) return res.status(400).json({ message: 'Bin code is required.' });
  if (!databaseEnabled) {
    const bin = createMemoryBin({
      locationId, code,
      zone: req.body.zone || null, aisle: req.body.aisle || null, rack: req.body.rack || null, shelf: req.body.shelf || null,
      capacity: req.body.capacity !== undefined ? Number(req.body.capacity) : null,
      storageClass: req.body.storageClass || null,
    });
    return res.status(201).json({ bin });
  }
  try {
    const bin = await prisma.bin.create({
      data: {
        locationId, code,
        zone: req.body.zone || null, aisle: req.body.aisle || null, rack: req.body.rack || null, shelf: req.body.shelf || null,
        capacity: req.body.capacity !== undefined ? Number(req.body.capacity) : null,
        storageClass: req.body.storageClass || null,
        isPickFace: req.body.isPickFace === true,
        pickFaceMin: req.body.pickFaceMin !== undefined ? Number(req.body.pickFaceMin) : null,
        pickFaceMax: req.body.pickFaceMax !== undefined ? Number(req.body.pickFaceMax) : null,
      },
    });
    return res.status(201).json({ bin });
  } catch (error) {
    return res.status(409).json({ message: error instanceof Error && error.message.includes('Unique') ? 'A bin with this code already exists at this location.' : 'Unable to create bin.' });
  }
});

router.patch('/bins/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data: Record<string, unknown> = {};
  for (const field of ['zone', 'aisle', 'rack', 'shelf', 'storageClass', 'status']) {
    if (req.body[field] !== undefined) data[field] = req.body[field] || null;
  }
  if (req.body.capacity !== undefined) data.capacity = req.body.capacity === null ? null : Number(req.body.capacity);
  if (req.body.isPickFace !== undefined) data.isPickFace = req.body.isPickFace === true;
  if (req.body.pickFaceMin !== undefined) data.pickFaceMin = req.body.pickFaceMin === null ? null : Number(req.body.pickFaceMin);
  if (req.body.pickFaceMax !== undefined) data.pickFaceMax = req.body.pickFaceMax === null ? null : Number(req.body.pickFaceMax);
  const ownedBin = await prisma.bin.findFirst({ where: { id: req.params.id, location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }, select: { id: true } }).catch(() => null);
  const bin = ownedBin ? await prisma.bin.update({ where: { id: ownedBin.id }, data }).catch(() => null) : null;
  if (!bin) return res.status(404).json({ message: 'Bin not found.' });
  return res.json({ bin });
});

router.post('/locations/:locationId/bin-transfers', async (req, res) => {
  const locationId = req.params.locationId;
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  const scannedFromBinCode = typeof req.body.fromBinCode === 'string' ? req.body.fromBinCode : '';
  const scannedToBinCode = typeof req.body.toBinCode === 'string' ? req.body.toBinCode : '';
  const quantity = Number(req.body.quantity);
  if (!itemId) return res.status(400).json({ message: 'itemId is required.' });

  const bins = databaseEnabled
    ? await prisma.bin.findMany({ where: { locationId, status: 'ACTIVE' } })
    : listMemoryBins(locationId);
  const allowedBinCodes = bins.map((bin) => bin.code);

  try {
    assertValidBinMove({ scannedFromBinCode, scannedToBinCode, allowedBinCodes, quantity });
  } catch (error) {
    if (error instanceof BinMoveValidationError) return res.status(400).json({ message: error.message });
    throw error;
  }

  const normalize = (code: string) => code.trim().toUpperCase();
  const fromBin = bins.find((bin) => normalize(bin.code) === normalize(scannedFromBinCode));
  const toBin = bins.find((bin) => normalize(bin.code) === normalize(scannedToBinCode));
  if (!fromBin || !toBin) return res.status(404).json({ message: 'Bin was not found at this location.' });

  try {
    const movement = await moveBinStockPersisted({
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      itemId, lotId: typeof req.body.lotId === 'string' ? req.body.lotId : null,
      locationId, binId: fromBin.id, toBinId: toBin.id, quantity,
      reference: typeof req.body.reference === 'string' ? req.body.reference : null,
      actorId: req.user!.id,
    });
    return res.status(201).json({ movement });
  } catch (error) {
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to move bin stock.' });
  }
});

router.get('/locations/:locationId/pick-face-replenishment', async (req, res) => {
  const locationId = req.params.locationId;
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) return res.json({ suggestions: [] });

  const bins = await prisma.bin.findMany({ where: { locationId, status: 'ACTIVE' } });
  const pickFaceBins = bins.filter((bin) => bin.isPickFace && bin.pickFaceMin !== null);
  if (!pickFaceBins.length) return res.json({ suggestions: [] });
  const reserveBinCodeById = new Map(bins.filter((bin) => !bin.isPickFace).map((bin) => [bin.id, bin.code]));

  const suggestions: Array<{ itemId: string; lotId?: string; fromBinId: string; fromBinCode: string; toBinId: string; toBinCode: string; quantity: number }> = [];
  for (const bin of pickFaceBins) {
    const pickFaceStock = await prisma.binStock.findMany({ where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationId, binId: bin.id } });
    const min = bin.pickFaceMin ?? 0;
    const max = bin.pickFaceMax ?? min;
    // One decision per item in this pick face (its rows are per lot, and were suggested separately).
    const onHandByItem = new Map<string, number>();
    for (const row of pickFaceStock) onHandByItem.set(row.itemId, (onHandByItem.get(row.itemId) ?? 0) + Number(row.onHand));
    for (const [itemId, onHand] of onHandByItem) {
      const reserveRows = await prisma.binStock.findMany({
        where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, locationId, itemId, binId: { in: [...reserveBinCodeById.keys()] } },
      });
      const lotIds = [...new Set(reserveRows.map((row) => row.lotId).filter(Boolean))];
      const lotInfo = new Map((lotIds.length ? await prisma.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, status: true, expiryDate: true } }) : []).map((lot) => [lot.id, lot]));
      const reserveCandidates = reserveRows
        .filter((row) => {
          const lot = lotInfo.get(row.lotId);
          // Never replenish a pick face from a blocked, quarantined or expired lot.
          return !lot || sellableQuantity({ onHand: Number(row.onHand), lot }) > 0;
        })
        .map((row) => ({ binId: row.binId, code: reserveBinCodeById.get(row.binId) ?? row.binId, onHand: Number(row.onHand), lotId: row.lotId || undefined, expiryDate: lotInfo.get(row.lotId)?.expiryDate?.toISOString() ?? null }));
      const suggestion = planPickFaceReplenishment({ binId: bin.id, code: bin.code, onHand, min, max }, reserveCandidates);
      if (suggestion) suggestions.push({ itemId, ...suggestion });
    }
  }
  return res.json({ suggestions });
});

router.get('/putaway-tasks', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const scope = locationId
    ? { locationId }
    : ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)
      ? {}
      : { locationId: { in: req.user!.locationIds ?? [] } };
  const tasks = await prisma.putawayTask.findMany({
    // A putaway task has no company column; it belongs to the company that owns its location. With no locationId an Admin's
    // scope is {} and this query used to return every company's tasks (item, lot and location names included).
    where: { ...scope, location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID }, ...(status ? { status } : { status: 'PENDING' }) },
    include: {
      item: { select: { id: true, code: true, name: true } },
      lot: { select: { id: true, lotNo: true, expiryDate: true } },
      location: { select: { id: true, code: true, name: true } },
      suggestedBin: { select: { id: true, code: true, zone: true, aisle: true, rack: true, shelf: true } },
      confirmedBin: { select: { id: true, code: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  return res.json({ tasks: decimalsToNumbers(tasks) });
});

router.post('/putaway-tasks/:id/confirm', async (req, res) => {
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const actor = req.user!;
  const body = req.body ?? {};
  const findTask = () => prisma.putawayTask.findFirst({
    where: { id: req.params.id, location: { companyId } },
    include: { suggestedBin: { select: { id: true, code: true } }, confirmedBin: { select: { id: true, code: true } } },
  });
  const task = await findTask();
  if (!task) return res.status(404).json({ message: 'Putaway task not found.' });
  if (!canAccessLocation(req, task.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER'].includes(actor.role)) {
    return res.status(403).json({ message: 'This role cannot confirm putaway.' });
  }
  const requireScan = actor.role === 'WAREHOUSE_PICKER' || Boolean(body.requireScan);
  const submittedCode = typeof body.scannedBinCode === 'string' ? body.scannedBinCode.trim().toUpperCase() : '';
  const requestedBinId = typeof body.binId === 'string' && body.binId ? body.binId : task.suggestedBinId;
  const reference = `putaway:${task.id}`;
  const replay = async (saved: Awaited<ReturnType<typeof findTask>>) => {
    if (saved?.status !== 'CONFIRMED' || saved.assignedToId !== actor.id || !saved.confirmedBin) return false;
    const sameDestination = submittedCode
      ? submittedCode === saved.confirmedBin.code.toUpperCase()
      : !requireScan && requestedBinId === saved.confirmedBin.id;
    if (!sameDestination) return false;
    const movement = await prisma.binMovement.findFirst({ where: {
      companyId, locationId: saved.locationId, reference, actorId: actor.id, toBinId: saved.confirmedBin.id,
    }, select: { id: true } });
    if (!movement) return false;
    const { confirmedBin, suggestedBin: _suggestion, ...receipt } = saved;
    res.json({ task: receipt, bin: confirmedBin, duplicate: true });
    return true;
  };
  if (task.status !== 'PENDING') {
    if (await replay(task)) return;
    return res.status(409).json({ message: 'This putaway task is already resolved.' });
  }
  const taskChanged = () => res.status(409).json({ code: 'PUTAWAY_TASK_CHANGED', message: 'This putaway task changed. Refresh your tasks and scan the destination bin again.' });
  const offlinePermit: unknown = body.offlinePermit;
  if (offlinePermit !== undefined && (typeof offlinePermit !== 'string' || !offlinePermit.length ||
      offlinePermit.length > 2_048 || typeof body.taskRevision !== 'string')) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'An offline putaway requires a valid permit and task revision.');
  }
  if (body.taskRevision !== undefined && body.taskRevision !== task.updatedAt.toISOString()) return taskChanged();
  const bins = await prisma.bin.findMany({ where: { locationId: task.locationId, status: 'ACTIVE' } });
  let scannedBinCode = submittedCode;
  const requestedBin = requestedBinId ? bins.find((bin) => bin.id === requestedBinId) : undefined;
  if (!scannedBinCode && requestedBin && !requireScan) scannedBinCode = requestedBin.code;
  const allowOverride = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role) && Boolean(req.body.allowOverride);
  const scanned = assertPutawayScan({
    scannedBinCode,
    suggestedBinCode: task.suggestedBin?.code ?? null,
    allowedBinCodes: bins.map((bin) => bin.code),
    allowOverride,
  });
  if (scanned.ok === false) return res.status(400).json({ message: scanned.message, code: scanned.code });
  const confirmedCode = (scannedBinCode || req.body.binCode || '').toString().trim().toUpperCase();
  const binFromScan = bins.find((bin) => bin.code.toUpperCase() === confirmedCode);
  const binId = binFromScan?.id ?? requestedBinId;
  if (!binId) return res.status(400).json({ message: 'A bin must be selected to confirm putaway.' });
  const bin = bins.find((row) => row.id === binId);
  if (!bin) return res.status(400).json({ message: 'Select an active bin at this location.' });
  if (!allowOverride && task.suggestedBin?.code && bin.code.toUpperCase() !== task.suggestedBin.code.toUpperCase()) {
    return res.status(400).json({ message: `Expected bin ${task.suggestedBin.code}; scanned ${bin.code}. Override is required to confirm a different bin.`, code: 'WRONG_BIN' });
  }
  try {
    const metadata = { binId: bin.id, binCode: bin.code, scanned: Boolean(submittedCode), companyId };
    const result = await prisma.$transaction(async (tx) => {
      const [updated] = await tx.putawayTask.updateManyAndReturn({
        where: { id: task.id, status: 'PENDING', updatedAt: task.updatedAt, location: { companyId } },
        data: { status: 'CONFIRMED', confirmedBinId: bin.id, confirmedAt: new Date(), assignedToId: actor.id },
      });
      if (!updated) return null;
      if (typeof offlinePermit === 'string') await enforceMobilePermit({ companyId, tenantId: DEFAULT_TENANT_ID,
        userId: actor.id, role: actor.role }, offlinePermit, 'putaway', tx);
      const [active] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Bin"
        WHERE id = ${bin.id} AND "locationId" = ${task.locationId} AND status = 'ACTIVE' AND code = ${bin.code}
        FOR SHARE
      `;
      if (!active) throw new InactivePutawayBin();
      await moveBinStockInTransaction(tx, {
        companyId, itemId: updated.itemId, lotId: updated.lotId, locationId: updated.locationId,
        binId: STAGING_BIN_ID, toBinId: bin.id, quantity: Number(updated.quantity), reference, actorId: actor.id,
      });
      const audit = await tx.auditLog.create({ data: {
        actorId: actor.id, actorRole: actor.role, action: 'PUTAWAY_CONFIRMED', entityType: 'PutawayTask', entityId: task.id, metadata,
      } });
      return { updated, audit };
    });
    if (!result) {
      if (await replay(await findTask())) return;
      return taskChanged();
    }
    rememberPersistedAudit({ ...result.audit, createdAt: result.audit.createdAt.toISOString(), metadata });
    return res.json({ task: result.updated, bin: { id: bin.id, code: bin.code } });
  } catch (error) {
    if (error instanceof BinStockShortageError) {
      return res.status(409).json({ code: 'PUTAWAY_STAGING_SHORTAGE', message: 'Staging has insufficient stock. Reconcile the intake before confirming putaway.' });
    }
    if (error instanceof InactivePutawayBin) return taskChanged();
    if (isDomainError(error)) return sendError(res, statusForErrorCode(error.code), error.code, error.message);
    throw error;
  }
});

class InactivePutawayBin extends Error {}

export default router;

// The routes below were registered later in the original file, after
// clusters that live in other routers; they keep their own router so the
// composer can mount them at their original position. The bare block
// shadows `router` so the moved registrations stay byte-identical.
export const binStockRouter = Router();
{
  const router = binStockRouter;
router.get('/locations/:locationId/bin-stock', async (req, res) => {
  if (!canAccessLocation(req, req.params.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const items = listItems();
  const serializeMemory = () => {
    if (!memoryBinStock.list({ locationId: req.params.locationId }).some((row) => row.onHand > 0)) {
      for (const row of listStockLedgerForLocation(req.params.locationId)) {
        if (row.onHand > 0) {
          memoryBinStock.apply({ itemId: row.itemId, lotId: row.lotId, locationId: req.params.locationId, binId: STAGING_BIN_ID }, row.onHand);
        }
      }
    }
    return memoryBinStock.list({ locationId: req.params.locationId }).filter((row) => row.onHand > 0).map((row) => ({
      ...row,
      item: items.find((item) => item.id === row.itemId) ?? { id: row.itemId, code: row.itemId, name: row.itemId },
    }));
  };
  if (!databaseEnabled) return res.json({ bins: serializeMemory() });
  // Phase 5 step 3: the database branch is the tenant-scoped repository
  // read, full stop. It used to fall back to serializeMemory() when
  // BinStock came back empty — serving snapshot-seeded staging rows in
  // database mode and mutating memory inside a GET (plan §2.5b). An empty
  // BinStock now answers { bins: [] }: "no bins configured yet" is a real
  // answer, and locations whose putaway never populated BinStock will show
  // it instead of being masked by the snapshot. The catch keeps the old
  // resilience to a pending BinStock migration.
  const rows = await listBinStockForLocation({
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    tenantId: DEFAULT_TENANT_ID,
    userId: req.user!.id,
    role: req.user!.role as TenantContext['role'],
  }, req.params.locationId).catch(() => [] as BinStockRow[]);
  return res.json({ bins: rows });
});

router.post('/pick-waves/:id/scan', async (req, res) => {
  if (!databaseEnabled) {
    const walkOrder = Array.isArray(req.body.walkOrder) ? req.body.walkOrder.map(String) : [];
    const scannedIndex = Number.isFinite(Number(req.body.scannedIndex)) ? Number(req.body.scannedIndex) : 0;
    const decision = assertGuidedWalkScan({
      scannedBinCode: String(req.body.scannedBinCode ?? ''),
      walkOrder,
      scannedIndex,
    });
    if (decision.ok === false) return res.status(400).json({ message: decision.message, code: decision.code, expected: walkOrder[scannedIndex] ?? null, walkOrder });
    return res.json({ ok: true, nextBin: walkOrder[scannedIndex + 1] ?? null, walkOrder, scannedIndex: scannedIndex + 1 });
  }
  const wave = await prisma.pickWave.findFirst({ where: { id: req.params.id, location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } } });
  if (!wave) return res.status(404).json({ message: 'Pick wave not found.' });
  if (!canAccessLocation(req, wave.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const transferIds = Array.isArray(wave.transferIds) ? wave.transferIds.map(String) : [];
  const walkBins: string[] = [];
  for (const transferId of transferIds) {
    const transfer = await prisma.transfer.findFirst({ where: { id: transferId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true } }).catch(() => null);
    if (!transfer) continue;
    for (const line of transfer.lines) {
      const bin = await lastKnownBin(wave.locationId, line.itemId, line.lotId ?? '');
      if (bin?.code) walkBins.push(bin.code);
    }
  }
  const walkOrder = [...new Set(walkBins.map((code) => code.toUpperCase()))].sort((a, b) => {
    const binA = walkBins.find((code) => code.toUpperCase() === a);
    const binB = walkBins.find((code) => code.toUpperCase() === b);
    return sequenceKeyForBin({ code: binA ?? a }).localeCompare(sequenceKeyForBin({ code: binB ?? b }));
  });
  const scannedIndex = Number.isFinite(Number(req.body.scannedIndex)) ? Number(req.body.scannedIndex) : 0;
  const decision = assertGuidedWalkScan({
    scannedBinCode: String(req.body.scannedBinCode ?? ''),
    walkOrder,
    scannedIndex,
  });
  if (decision.ok === false) return res.status(400).json({ message: decision.message, code: decision.code, expected: walkOrder[scannedIndex] ?? null, walkOrder });
  return res.json({ ok: true, nextBin: walkOrder[scannedIndex + 1] ?? null, walkOrder, scannedIndex: scannedIndex + 1 });
});
}
