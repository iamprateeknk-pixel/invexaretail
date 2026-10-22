// Import routes for core (Phase 4): stock-update imports, import
// batches, opening stock, stock adjustments, daily sales/purchase
// imports, transfer imports and stock takes. Extracted verbatim
// from core.ts; the composer mounts these routers at the clusters'
// original registration positions.
import { type NextFunction, type Request, type Response, Router } from 'express';
import { createHash } from 'node:crypto';
import { DEFAULT_COMPANY_ID, companyOwnsItem, itemsForCompany, scopedImportKey, locationsForCompany, registerItemCompany } from '../lib/saas/tenant-scope.js';
import { controlPlane } from '../lib/saas/control-plane.js';
import { assertCountLocationAccess, canManageCountWork, isCountWorkerRole, parseCountPriority, parseOptionalDueDate } from '../lib/count-lifecycle.js';
import { createCountAssignment, createTransferRecord, adjustStockLedger, ensureLotRecord, findStockLedgerEntry, findUserById, listItems, listLocations, listStockLedgerForLocation, locations, recordDailyMovement, upsertSyncCheckpoint, upsertItemRecord, type LocationRecord, type TransferRecord } from '../lib/repository.js';
import { checkApprovalGate } from '../lib/approval-rules.js';
import { estimateValueAtRisk } from '../lib/exceptions.js';
import { recordAudit } from '../lib/audit.js';
import { applyLateMovementsQuietly } from '../lib/late-movement-service.js';
import { isOperationalItem, resolveItemByIdentity } from '../lib/item-master.js';
import { persistAudit, persistCountAssignment, persistItem, persistOpeningStockImport, persistDailyMovementImport, persistTransfer, saveImportedCustomValuesSafely } from '../lib/persistence.js';
import { importTemplateCsv, type ImportKind } from '../lib/import-profile.js';
import { aggregateOpeningStock, importPreviewResponse, parseStockImport, readTabularFile, type StockImportPreview } from '../lib/stock-import.js';
import { allocateLots, parseTransferImport } from '../lib/warehouse-workflow.js';
import { getActiveWorkflow } from '../lib/industry-packs.js';
import { matchImportLocation, parseDailyStockImport, type DailyImportPreview, type DailyStockRow } from '../lib/daily-stock-sync.js';
import { listImportBatches, reverseImportBatch } from '../lib/import-reversal.js';
import { computeFileHash, ConcurrentBatchTransitionError, InvalidBatchTransitionError } from '../lib/import-center.js';
import { withDistributedLock } from '../lib/distributed-lock.js';
import { countRowsByStatus, createPreviewBatch, findDuplicateBatch, getBatch, listRows, completeBatchPosting, transitionBatch } from '../lib/import-batch-store.js';
import { buildBatchPreviewPayload, buildErrorCsv, duplicateConflictMessage, movementsFromStagedDailyRows, openingPreviewFromStagedRows, stageDailyImport, stageOpeningStock, stageStockAdjustment } from '../lib/import-token-flow.js';
import { type DailyMovementRecord, type LotRecord } from '../lib/repository.js';
import { prisma } from '../lib/db.js';
import { listRecentMovementsForCompany } from '../lib/repositories/movement-repository.js';
import { accessContext, tenantContext, firstParam, inactiveItemMessage, isOperationalAdmin, upload } from './core-shared.js';

const router = Router();

type StockUpdateMode = 'SET' | 'ADD' | 'REMOVE';

function stockImportId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha1').update(value.trim().toLowerCase()).digest('hex').slice(0, 20)}`;
}

function validatedStockUpdateMode(value: unknown): StockUpdateMode {
  const mode = String(value ?? '').toUpperCase();
  if (!['SET', 'ADD', 'REMOVE'].includes(mode)) throw new Error('Update mode must be SET, ADD or REMOVE.');
  return mode as StockUpdateMode;
}

function stockUpdateDelta(mode: StockUpdateMode, quantity: number, current: number): number {
  if (!Number.isFinite(quantity)) throw new Error('Quantity must be a valid number.');
  // SET assigns an absolute closing balance, so it may set stock to zero or to
  // a negative on-hand (a legitimate exported closing-stock figure e.g. after
  // an oversell/reconciliation gap) - the ERP source of truth wins outright.
  // ADD/REMOVE are relative deltas from current stock, so they still require a
  // positive quantity and still cannot drive stock negative.
  if (mode === 'SET') return quantity - current;
  if (quantity <= 0) throw new Error('Quantity must be a valid positive number for ADD/REMOVE.');
  const delta = mode === 'ADD' ? quantity : -quantity;
  if (current + delta < 0) throw new Error(`Update would make stock negative (current ${current}, change ${delta}).`);
  return delta;
}

export function planStockUpdate(preview: StockImportPreview, mode: StockUpdateMode, companyId: string = DEFAULT_COMPANY_ID) {
  const errors = [...preview.errors];
  const prepared: Array<{ row: StockImportPreview['validRows'][number]; item: ReturnType<typeof listItems>[number]; location: LocationRecord; lotId: string; lotNo: string; expiryDate?: string | null; isNewLot: boolean; isNewItem: boolean; isNewLocation: boolean; currentQty: number; qtyDelta: number; resultingQty: number }> = [];
  // The company's own items and locations only: a file must never match, and then adjust, another company's.
  const existingItems = itemsForCompany(companyId, listItems());
  const existingLocations = locationsForCompany(companyId, listLocations());
  const plannedItems = new Map<string, ReturnType<typeof listItems>[number]>();
  const plannedLocations = new Map<string, LocationRecord>();
  const newItemIds = new Set<string>();
  const newLocationIds = new Set<string>();
  if (preview.format !== 'invexa-expiry-stock') errors.push({ rowNumber: 0, message: 'Bulk stock update requires Branch Name, Item Code/Name, Lot Code and Quantity/Closing Stock columns.' });
  for (const row of aggregateOpeningStock(preview.validRows)) {
    const codeKey = row.code.trim().toLowerCase();
    const itemNameKey = row.itemName.trim().toLowerCase();
    let item = existingItems.find((candidate) => candidate.code.trim().toLowerCase() === codeKey)
      ?? existingItems.find((candidate) => candidate.name.trim().toLowerCase() === itemNameKey)
      ?? plannedItems.get(codeKey);
    let isNewItem = false;
    if (!item && mode === 'SET') {
      item = {
        id: stockImportId('item-erp', scopedImportKey(companyId, row.code)),
        code: row.code,
        name: row.itemName,
        category: row.category,
        subcategory: row.subcategory,
        company: row.companyName,
        unit: row.unit,
        lots: [],
      };
      plannedItems.set(codeKey, item);
      newItemIds.add(item.id);
      isNewItem = true;
    } else if (item) {
      isNewItem = newItemIds.has(item.id);
    }
    const locationKey = row.locationName?.trim().toLowerCase() ?? '';
    let location = existingLocations.find((candidate) => candidate.name.trim().toLowerCase() === locationKey)
      ?? plannedLocations.get(locationKey);
    let isNewLocation = false;
    if (!location && mode === 'SET' && row.locationName) {
      const normalizedLocation = row.locationName.toLowerCase().replace(/[^a-z0-9]+/g, '');
      location = {
        id: stockImportId('loc-erp', scopedImportKey(companyId, locationKey)),
        name: row.locationName,
        type: normalizedLocation === 'hobasni' || normalizedLocation === 'basni' ? 'warehouse' : 'store',
      };
      plannedLocations.set(locationKey, location);
      newLocationIds.add(location.id);
      isNewLocation = true;
    } else if (location) {
      isNewLocation = newLocationIds.has(location.id);
    }
    if (!item) { errors.push({ rowNumber: row.rowNumber, message: `Unknown item: ${row.code || row.itemName}` }); continue; }
    if (!location) { errors.push({ rowNumber: row.rowNumber, message: `Unknown branch/location: ${row.locationName}` }); continue; }
    const lotNo = row.lotNo || 'LOT-DEFAULT';
    const existingLot = item.lots.find((candidate) => candidate.lotNo.trim().toLowerCase() === lotNo.trim().toLowerCase());
    const lotId = existingLot?.id ?? (mode === 'SET'
      ? stockImportId('lot-erp', `${item.id}|${lotNo}`)
      : `lot-update-${item.id}-${lotNo.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 190));
    const currentQty = findStockLedgerEntry(item.id, lotId, location.id)?.onHand ?? 0;
    try {
      const qtyDelta = stockUpdateDelta(mode, Number(row.quantity), currentQty);
      prepared.push({ row, item, location, lotId, lotNo, expiryDate: row.expiryDate, isNewLot: !existingLot, isNewItem, isNewLocation, currentQty, qtyDelta, resultingQty: currentQty + qtyDelta });
    } catch (error) { errors.push({ rowNumber: row.rowNumber, message: error instanceof Error ? error.message : 'Invalid stock quantity.' }); }
  }
  return { errors, prepared, newItems: newItemIds.size, newLocations: newLocationIds.size };
}

function stockUpdatePreviewResponse(preview: StockImportPreview, plan: ReturnType<typeof planStockUpdate>) {
  return { sheetName: preview.sheetName, headerRow: preview.headerRow, totalRows: preview.totalRows, validRows: plan.prepared.length, invalidRows: plan.errors.length, duplicateRows: preview.duplicateRows, newItems: plan.newItems, newLocations: plan.newLocations, branches: preview.branches, errors: plan.errors.slice(0, 100), sample: plan.prepared.slice(0, 20).map((entry) => ({ rowNumber: entry.row.rowNumber, itemCode: entry.item.code, itemName: entry.item.name, locationName: entry.location.name, lotNo: entry.lotNo, currentQty: entry.currentQty, qtyDelta: entry.qtyDelta, resultingQty: entry.resultingQty, willCreateItem: entry.isNewItem, willCreateLocation: entry.isNewLocation })) };
}

async function readUploadedStockFile(req: Request): Promise<StockImportPreview> {
  if (!req.file) throw new Error('No file uploaded.');
  if (!/\.(xlsx|xls|csv)$/i.test(req.file.originalname)) {
    throw new Error('Only .xlsx, .xls and .csv files are supported.');
  }
  return parseStockImport(req.file.buffer, req.file.originalname, controlPlane.getImportProfile(req.companyId ?? DEFAULT_COMPANY_ID, 'OPENING_STOCK'));
}

// Header row + sample row in the company's configured column order (Control Plane > Studio > Import columns).
const TEMPLATE_ROUTES: Array<[string, ImportKind, string]> = [
  ['opening-stock', 'OPENING_STOCK', 'invexa-opening-stock-template.csv'],
  ['sales', 'SALES', 'invexa-sales-template.csv'],
  ['purchases', 'PURCHASE', 'invexa-purchase-template.csv'],
];
for (const [path, kind, filename] of TEMPLATE_ROUTES) {
  router.get(`/imports/${path}/template`, (req: Request, res: Response) => {
    const csv = importTemplateCsv(controlPlane.getImportProfile(req.companyId ?? DEFAULT_COMPANY_ID, kind), kind);
    return res.json({ filename, csv });
  });
}

router.get('/imports/batches', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Import history access denied.' });
  }
  try {
    const batches = await listImportBatches(req.companyId ?? DEFAULT_COMPANY_ID, Number(req.query.limit ?? 100));
    // Blueprint v4 §10.1: a batch is reversible while it is POSTED and is not itself a reversal.
    return res.json({ batches: batches.map((batch) => ({ ...batch, reversible: batch.status === 'POSTED' && !String(batch.type).includes('REVERS') })) });
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'Import history is unavailable.' });
  }
});

router.get('/imports/history', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  // The movement list is process-wide. Only movements at locations the caller's company owns belong in its history;
  // a location with no known owner belongs to nobody, so it is left out rather than shown to everyone.
  // Database-first slice 2: read through the scoped movement repository (Postgres in database mode).
  return res.json({ movements: await listRecentMovementsForCompany(tenantContext(req)) });
});

router.get('/imports/:batchToken/errors', async (req: Request, res: Response, next: NextFunction) => {
  const batchToken = firstParam(req.params.batchToken);
  if (RESERVED_IMPORT_PATHS.has(batchToken)) return next();
  if (!isOperationalAdmin(req.user!.role) && req.user!.role !== 'AUDITOR') return res.status(403).json({ message: 'Import access denied.' });
  const csv = await buildErrorCsv(req.companyId ?? DEFAULT_COMPANY_ID, batchToken);
  if (csv === undefined) return res.status(404).json({ message: 'Import batch was not found.' });
  if (String(req.query.format ?? 'csv').toLowerCase() === 'json') {
    return res.json({ batchToken, csv });
  }
  return res.type('text/csv').attachment(`import-${batchToken}-errors.csv`).send(csv);
});

router.get('/imports/:batchToken', async (req: Request, res: Response, next: NextFunction) => {
  const batchToken = firstParam(req.params.batchToken);
  if (RESERVED_IMPORT_PATHS.has(batchToken)) return next();
  if (!isOperationalAdmin(req.user!.role) && req.user!.role !== 'AUDITOR') return res.status(403).json({ message: 'Import access denied.' });
  const preview = await buildBatchPreviewPayload(req.companyId ?? DEFAULT_COMPANY_ID, batchToken);
  if (!preview) return res.status(404).json({ message: 'Import batch was not found.' });
  return res.json(preview);
});

const RESERVED_IMPORT_PATHS = new Set(['batches', 'history', 'opening-stock', 'sales', 'purchases']);

router.post('/imports/:batchToken/abandon', async (req: Request, res: Response, next: NextFunction) => {
  const batchToken = firstParam(req.params.batchToken);
  if (RESERVED_IMPORT_PATHS.has(batchToken)) return next();
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access is required to abandon an import.' });
  try {
    const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
    const batch = await getBatch(companyId, batchToken);
    if (!batch) return res.status(404).json({ message: 'Import batch was not found.' });
    if (batch.importedById !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Only the importer or Main Admin can abandon this preview.' });
    }
    const updated = await transitionBatch(companyId, batch.id, 'FAILED', { abandonedBy: req.user!.id, abandonedAt: new Date().toISOString() });
    return res.json({ message: 'Preview abandoned. You can upload this file again.', batchToken: updated.id, status: updated.status });
  } catch (error) {
    if (error instanceof InvalidBatchTransitionError) return res.status(409).json({ message: error.message });
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to abandon import.' });
  }
});

router.post('/imports/:batchToken/commit', async (req: Request, res: Response, next: NextFunction) => {
  const batchToken = firstParam(req.params.batchToken);
  if (RESERVED_IMPORT_PATHS.has(batchToken)) return next();
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access is required to commit imports.' });
  try {
    // commitImportBatchToken posts real stock movements before flipping the
    // batch to POSTED; without a lock here, a double-click or client retry
    // sends two concurrent commit requests that both pass the PREVIEWED/
    // VALIDATED status check and both post - not just an ugly "POSTED to
    // POSTED" transition error, but the underlying stock getting applied
    // twice. Serialize commits per batch so the second request always sees
    // the first one's already-POSTED result instead of racing it.
    const outcome = await withDistributedLock(`import-batch-commit:${batchToken}`, () => commitImportBatchToken(req, res, batchToken));
    if (outcome === null) {
      return res.status(409).json({ message: 'This import is already being committed by another request. Please wait and refresh.' });
    }
    return outcome;
  } catch (error) {
    if (error instanceof ConcurrentBatchTransitionError) {
      return res.status(409).json({ message: 'This import was already committed by a concurrent request.' });
    }
    if (error instanceof InvalidBatchTransitionError) return res.status(409).json({ message: error.message });
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to commit import.' });
  }
});

router.post('/imports/:batchId/reverse', async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Only the Main Admin can reverse a posted import.' });
  }
  const batchId = firstParam(req.params.batchId);
  try {
    const result = await reverseImportBatch({
      batchId,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      actorId: req.user!.id,
      reason: typeof req.body.reason === 'string' ? req.body.reason : '',
    });
    if (!result.duplicate) {
      for (const line of result.plan) {
        adjustStockLedger(line.itemId, line.lotId, line.locationId, line.qtyDelta);
        recordDailyMovement({
          id: `reversal-memory-${batchId}-${line.itemId}-${line.lotId}-${line.locationId}`,
          dedupeKey: `reversal-memory:${batchId}:${line.itemId}:${line.lotId}:${line.locationId}`,
          itemId: line.itemId,
          lotId: line.lotId,
          locationId: line.locationId,
          movementType: 'ADJUSTMENT',
          qtyDelta: line.qtyDelta,
          transactionAt: new Date().toISOString(),
          sourceType: 'ADJUSTMENT',
          sourceReference: batchId,
          createdById: req.user!.id,
          metadata: { reversalBatchId: result.reversalBatchId, operation: 'IMPORT_REVERSAL' },
        });
      }
    }
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: result.duplicate ? 'IMPORT_REVERSAL_RETRY' : 'IMPORT_REVERSED',
      entityType: 'ImportBatch',
      entityId: batchId,
      metadata: { reason: req.body.reason, reversalBatchId: result.reversalBatchId, reversedMovements: result.reversedMovements, duplicate: result.duplicate },
    }));
    return res.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import reversal failed.';
    return res.status(message.includes('not found') ? 404 : message.includes('already') ? 409 : 400).json({ message });
  }
});

router.post('/imports/opening-stock/preview', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can preview imports.' });
  }
  try {
    const preview = await readUploadedStockFile(req);
    const fileHash = computeFileHash(req.file!.buffer);
    const existing = await findDuplicateBatch({
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      type: 'OPENING_STOCK',
      fileHash,
      branchId: null,
      sourceDateFrom: preview.snapshotAt,
      sourceDateTo: preview.snapshotAt,
    });
    if (existing) return duplicateFileResponse(res, req.companyId ?? DEFAULT_COMPANY_ID, existing.id);
    const staged = stageOpeningStock(preview);
    const batch = await createPreviewBatch({
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      type: 'OPENING_STOCK',
      fileName: req.file!.originalname,
      sourceFormat: preview.format,
      importedById: req.user!.id,
      fileHash,
      sourceDateFrom: preview.snapshotAt,
      sourceDateTo: preview.snapshotAt,
      totalRows: staged.length,
      validRows: staged.filter((row) => row.status === 'VALID').length,
      invalidRows: staged.filter((row) => row.status === 'INVALID').length,
      duplicateRows: preview.duplicateRows,
      metadata: {
        sheetName: preview.sheetName,
        headerRow: preview.headerRow,
        format: preview.format,
        snapshotAt: preview.snapshotAt,
        branches: preview.branches,
        mapping: preview.mapping,
        negativeQuantityRows: preview.negativeQuantityRows,
        fractionalQuantityRows: preview.fractionalQuantityRows,
      },
      rows: staged,
    });
    return res.json({ batchToken: batch.id, preview: { ...importPreviewResponse(preview), batchToken: batch.id, status: batch.status } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to read import file.' });
  }
});

router.post('/imports/opening-stock/commit', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can commit imports.' });
  }
  try {
    const preview = await readUploadedStockFile(req);
    if (!preview.validRows.length) {
      return res.status(400).json({ message: 'No valid rows were found to import.', preview: importPreviewResponse(preview) });
    }

    if (preview.format === 'invexa-expiry-stock') {
      if (req.body.mode !== 'replace-current') {
        return res.status(400).json({ message: 'Confirm replace-current mode after reviewing the preview.' });
      }
      const result = await persistOpeningStockImport(preview, req.file!.originalname, req.user!.id, { companyId: req.companyId ?? DEFAULT_COMPANY_ID });
      await persistAudit(recordAudit({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: 'OPENING_STOCK_IMPORTED',
        entityType: 'ImportBatch',
        entityId: result.batchId,
        metadata: {
          fileName: req.file!.originalname,
          format: preview.format,
          totalRows: preview.totalRows,
          validRows: preview.validRows.length,
          invalidRows: preview.errors.length,
          duplicateRows: preview.duplicateRows,
          branches: preview.branches,
          ...result,
        },
      }));
      return res.json({
        message: `Imported ${result.stockRows} branch/item/lot stock rows from ${preview.validRows.length} valid rows.`,
        result,
        preview: importPreviewResponse(preview),
      });
    }

    let created = 0;
    let updated = 0;
    const imported = [];
    for (const row of preview.validRows) {
      const result = await upsertCompanyItem({ code: row.code, name: row.itemName, category: row.category, subcategory: row.subcategory, company: row.companyName, unit: row.unit }, req.companyId ?? DEFAULT_COMPANY_ID);
      imported.push(result.item);
      if (result.created) created += 1;
      else updated += 1;
    }
    const customValues = await saveImportedCustomValuesSafely(req.companyId ?? DEFAULT_COMPANY_ID, preview.validRows);
    return res.json({ message: `Imported ${imported.length} items (${created} new, ${updated} updated).`, imported, preview: importPreviewResponse(preview), ...customValues });
  } catch (error) {
    return res.status(400).json({ message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
});

router.post('/stock-adjustments/manual', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for stock updates.' });
  try {
    const mode = validatedStockUpdateMode(req.body.mode);
    const item = listItems().find((candidate) => candidate.id === req.body.itemId);
    const location = listLocations().find((candidate) => candidate.id === req.body.locationId);
    if (!item) return res.status(400).json({ message: 'Select a valid item.' });
    if (!location) return res.status(400).json({ message: 'Select a valid location.' });
    const reason = String(req.body.reason ?? '').trim();
    if (reason.length < 3) return res.status(400).json({ message: 'Enter a reason for this auditable stock update.' });
    const lotNo = String(req.body.lotNo ?? '').trim() || item.lots[0]?.lotNo || 'LOT-DEFAULT';
    const existingLot = item.lots.find((candidate) => candidate.lotNo.trim().toLowerCase() === lotNo.toLowerCase());
    const lotId = existingLot?.id ?? `lot-update-${item.id}-${lotNo.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 190);
    const currentQty = findStockLedgerEntry(item.id, lotId, location.id)?.onHand ?? 0;
    const qtyDelta = stockUpdateDelta(mode, Number(req.body.quantity), currentQty);
    const requestId = String(req.body.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    // Blueprint §16.2: "manual stock adjustment -> dual control for
    // high-value category." Gated on the same requestId the client already
    // sends for idempotency, so resubmitting the identical form after
    // approval both finds the APPROVED request and proceeds.
    const adjustmentValue = (await estimateValueAtRisk(tenantContext(req), item.id, Math.abs(qtyDelta))) ?? 0;
    const adjustmentLocation = await prisma.location.findUnique({ where: { id: location.id }, select: { branchId: true } }).catch(() => null);
    const gate = await checkApprovalGate({
      triggerType: 'STOCK_ADJUSTMENT', entityType: 'StockAdjustment', entityId: requestId,
      category: item.category ?? null, branchId: adjustmentLocation?.branchId ?? null, value: adjustmentValue, requestedById: req.user!.id,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    });
    if (gate.blocked) return res.status(409).json({ message: gate.reason, approvalRequestId: gate.requestId, requiredApproverRole: gate.requiredApproverRole, requestId });

    const batchId = `adjust-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const movement = { id: `move-${batchId}`, dedupeKey: `ADJUSTMENT|MANUAL|${requestId}`, itemId: item.id, lotId, locationId: location.id, movementType: `MANUAL_${mode}`, qtyDelta, transactionAt: new Date().toISOString(), sourceType: 'ADJUSTMENT' as const, sourceReference: requestId, importBatchId: batchId, createdById: req.user!.id, metadata: { reason, mode, requestedQuantity: Number(req.body.quantity), previousQty: currentQty, resultingQty: currentQty + qtyDelta } };
    const newLots = existingLot ? [] : [{ id: lotId, itemId: item.id, lotNo, expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate).toISOString() : null, attributes: { source: 'manual-stock-update' } }];
    const result = await persistDailyMovementImport({ batchId, importType: 'ADJUSTMENT', fileName: 'Manual stock update', importedBy: req.user!.id, totalRows: 1, invalidRows: 0, duplicateRows: 0, movements: [movement], lots: newLots, checkpoints: [], companyId: req.companyId ?? DEFAULT_COMPANY_ID });
    if (newLots[0]) ensureLotRecord(item.id, lotNo, newLots[0].expiryDate, newLots[0].attributes, lotId);
    if (result.committedRows) { recordDailyMovement(movement); adjustStockLedger(item.id, lotId, location.id, qtyDelta); }
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_MANUALLY_UPDATED', entityType: 'StockLedger', entityId: `${item.id}|${lotId}|${location.id}`, metadata: movement.metadata }));
    return res.status(201).json({ message: result.committedRows ? `Stock updated from ${currentQty} to ${currentQty + qtyDelta}.` : 'This stock update was already applied.', itemId: item.id, lotId, locationId: location.id, previousQty: currentQty, qtyDelta, resultingQty: result.committedRows ? currentQty + qtyDelta : currentQty });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to update stock.' }); }
});

router.post('/stock-adjustments/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for stock updates.' });
  try {
    const mode = validatedStockUpdateMode(req.body.mode);
    const preview = await readUploadedStockFile(req);
    const fileHash = computeFileHash(req.file!.buffer);
    const existing = await findDuplicateBatch({ companyId: req.companyId ?? DEFAULT_COMPANY_ID, type: `ADJUSTMENT_${mode}`, fileHash, branchId: null, sourceDateFrom: preview.snapshotAt, sourceDateTo: preview.snapshotAt });
    if (existing) return duplicateFileResponse(res, req.companyId ?? DEFAULT_COMPANY_ID, existing.id);
    const plan = planStockUpdate(preview, mode, req.companyId ?? DEFAULT_COMPANY_ID);
    const staged = stageStockAdjustment(preview, plan, mode);
    const batch = await createPreviewBatch({
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      type: `ADJUSTMENT_${mode}`,
      fileName: req.file!.originalname,
      sourceFormat: preview.format,
      importedById: req.user!.id,
      fileHash,
      sourceDateFrom: preview.snapshotAt,
      sourceDateTo: preview.snapshotAt,
      totalRows: staged.length,
      validRows: staged.filter((row) => row.status === 'VALID').length,
      invalidRows: staged.filter((row) => row.status === 'INVALID').length,
      duplicateRows: preview.duplicateRows,
      metadata: { sheetName: preview.sheetName, headerRow: preview.headerRow, format: preview.format, snapshotAt: preview.snapshotAt, mode, newItems: plan.newItems, newLocations: plan.newLocations, branches: preview.branches, mapping: preview.mapping },
      rows: staged,
    });
    return res.json({ batchToken: batch.id, preview: { ...stockUpdatePreviewResponse(preview, plan), batchToken: batch.id, status: batch.status } });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview stock update.' }); }
});

router.post('/stock-adjustments/import/commit', upload.single('file'), async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for stock updates.' });
  if (!req.file) return res.status(400).json({ message: 'Select an Excel or CSV file.' });
  try {
    const mode = validatedStockUpdateMode(req.body.mode);
    const preview = await readUploadedStockFile(req);
    const plan = planStockUpdate(preview, mode, req.companyId ?? DEFAULT_COMPANY_ID);
    if (plan.errors.length || !plan.prepared.length) return res.status(400).json({ message: 'Fix all invalid rows before confirming.', preview: stockUpdatePreviewResponse(preview, plan) });
    if (mode === 'SET') {
      const result = await persistOpeningStockImport(preview, req.file.originalname, req.user!.id, { companyId: req.companyId ?? DEFAULT_COMPANY_ID });
      await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_UPDATE_FILE_IMPORTED', entityType: 'ImportBatch', entityId: result.batchId, metadata: { fileName: req.file.originalname, mode, rows: result.stockRows, importedItems: result.importedItems, importedLots: result.importedLots, importedLocations: result.importedLocations } }));
      return res.status(201).json({ message: `Set exact stock for ${result.stockRows} branch/item/lot rows.`, batchId: result.batchId, committedRows: result.stockRows, ...result });
    }
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 24);
    const batchId = `adjust-import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const transactionAt = new Date().toISOString();
    const movements = plan.prepared.map((entry, index) => ({ id: `move-${batchId}-${index}`, dedupeKey: `ADJUSTMENT|${mode}|${fileHash}|${entry.item.id}|${entry.lotId}|${entry.location.id}`, itemId: entry.item.id, lotId: entry.lotId, locationId: entry.location.id, movementType: `BULK_${mode}`, qtyDelta: entry.qtyDelta, transactionAt, sourceType: 'ADJUSTMENT' as const, sourceReference: req.file!.originalname, importBatchId: batchId, createdById: req.user!.id, metadata: { sourceRow: entry.row.rowNumber, mode, previousQty: entry.currentQty, resultingQty: entry.resultingQty } }));
    const lots = plan.prepared.filter((entry) => entry.isNewLot).map((entry) => ({ id: entry.lotId, itemId: entry.item.id, lotNo: entry.lotNo, expiryDate: entry.expiryDate ?? null, attributes: { source: 'bulk-stock-update' } }));
    const result = await persistDailyMovementImport({ batchId, importType: 'ADJUSTMENT', fileName: req.file.originalname, importedBy: req.user!.id, totalRows: preview.totalRows, invalidRows: preview.errors.length, duplicateRows: preview.duplicateRows, movements, lots, checkpoints: [], companyId: req.companyId ?? DEFAULT_COMPANY_ID });
    for (const lot of lots) ensureLotRecord(lot.itemId, lot.lotNo, lot.expiryDate, lot.attributes, lot.id);
    if (result.committedRows) for (const movement of movements) { recordDailyMovement(movement); adjustStockLedger(movement.itemId, movement.lotId!, movement.locationId, movement.qtyDelta); }
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_UPDATE_FILE_IMPORTED', entityType: 'ImportBatch', entityId: batchId, metadata: { fileName: req.file.originalname, mode, rows: result.committedRows, fileHash } }));
    return res.status(201).json({ message: result.committedRows ? `Updated ${result.committedRows} branch/item/lot stock rows.` : 'This exact file and mode were already applied; stock was not changed again.', batchId, committedRows: result.committedRows });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to commit stock update.' }); }
});

// An item import creates or updates items BY CODE. Both the lookup and the new item belong to the caller's company: the
// process-wide lookup let one company's file overwrite another company's item with the same code, and a new item was
// stored under the default company because persistItem was called without one.
async function upsertCompanyItem(input: Parameters<typeof upsertItemRecord>[0], companyId: string) {
  const result = upsertItemRecord(input, (item) => companyOwnsItem(companyId, item.id));
  if (result.created) registerItemCompany(result.item.id, companyId);
  await persistItem(result.item, companyId);
  return result;
}

router.post('/import/items', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can import data.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const preview = await readUploadedStockFile(req);
    if (preview.format !== 'standard-items') {
      return res.status(400).json({ message: 'Opening-stock files require Preview and Confirm. Use /imports/opening-stock/preview first.' });
    }
    const imported = [];
    for (const row of preview.validRows) {
      const { item } = await upsertCompanyItem({ code: row.code, name: row.itemName, category: row.category, subcategory: row.subcategory, company: row.companyName, unit: row.unit }, req.companyId ?? DEFAULT_COMPANY_ID);
      imported.push(item);
    }
    const customValues = await saveImportedCustomValuesSafely(req.companyId ?? DEFAULT_COMPANY_ID, preview.validRows);
    return res.json({ message: `Imported ${imported.length} items.`, imported, preview: importPreviewResponse(preview), ...customValues });
  } catch (error) {
    return res.status(400).json({ message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
});

// ---------------------------------------------------------------------------
// Daily external ERP sync: purchases only enter H.O. Basni warehouse; sales
// leave their source branch and sales returns add stock back to that branch.
// ---------------------------------------------------------------------------
const normalName = (input: string) => input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');


function configuredPurchaseWarehouse(companyId: string = DEFAULT_COMPANY_ID) {
  const warehouses = locationsForCompany(companyId, listLocations()).filter((location) => location.type === 'warehouse');
  const basni = warehouses.find((location) => /basni|hobasni|ho/.test(normalName(location.name)));
  return basni ?? (warehouses.length === 1 ? warehouses[0] : undefined);
}

/**
 * The location the admin chose at import time for a purchase file ("Receive into"), checked to be one of this
 * company's own locations. Undefined when nothing was chosen: the purchase then goes to the configured H.O. Basni warehouse.
 */
function requestedPurchaseDestination(companyId: string, requestedId: unknown) {
  const id = typeof requestedId === 'string' ? requestedId.trim() : '';
  if (!id) return undefined;
  const location = locationsForCompany(companyId, listLocations()).find((entry) => entry.id === id);
  if (!location) throw new Error('Choose one of your own locations to receive the purchase into.');
  return location;
}

function dailyItem(row: DailyStockRow, companyId: string = DEFAULT_COMPANY_ID) {
  const catalog = itemsForCompany(companyId, listItems());
  const code = row.itemCode ? catalog.find((item) => normalName(item.code) === normalName(row.itemCode!)) : undefined;
  if (code) return code;
  // ERP alias / barcode mapping (blueprint v4 §10); a row with a code never falls back to its name.
  if (row.itemCode) return resolveItemByIdentity(catalog, { code: row.itemCode }).item;
  const matched = catalog.filter((item) => normalName(item.name) === normalName(row.itemName));
  if (matched.length === 1) return matched[0];
  return matched.length === 0 ? resolveItemByIdentity(catalog, { name: row.itemName }).item : undefined;
}

function inactiveImportMessage(item: { code: string; status?: string }): string {
  return `Item ${item.code} is ${String(item.status ?? 'inactive').toLowerCase()} and cannot be imported.`;
}

function planDailyImport(preview: DailyImportPreview, importedBy: string, companyId: string = DEFAULT_COMPANY_ID, destination?: ReturnType<typeof requestedPurchaseDestination>) {
  const errors = [...preview.errors]; const warehouse = destination ?? configuredPurchaseWarehouse(companyId); const prepared: Array<{ row: DailyStockRow; item: ReturnType<typeof listItems>[number]; locationId: string; lotId: string; qtyDelta: number; newLot?: ReturnType<typeof ensureLotRecord> }> = [];
  if (preview.importType === 'PURCHASE' && !warehouse) errors.push({ rowNumber: 0, message: 'Choose where to receive the purchase, or set one warehouse as H.O. Basni.' });
  for (const row of preview.validRows) {
    const item = dailyItem(row, companyId);
    if (!item) { errors.push({ rowNumber: row.rowNumber, message: row.itemCode ? `Unknown Item Code: ${row.itemCode}` : `Unknown or ambiguous Item Name: ${row.itemName}` }); continue; }
    if (!isOperationalItem(item)) { errors.push({ rowNumber: row.rowNumber, message: inactiveImportMessage(item) }); continue; }
    const location = preview.importType === 'PURCHASE' ? warehouse : matchImportLocation(row.locationName, locationsForCompany(companyId, listLocations()));
    if (!location) { errors.push({ rowNumber: row.rowNumber, message: `Unknown ${preview.importType === 'PURCHASE' ? 'purchase location' : 'sales branch'}: ${row.locationName}` }); continue; }
    if (preview.importType === 'PURCHASE' && !destination && location.type !== 'warehouse') { errors.push({ rowNumber: row.rowNumber, message: 'Purchase can be received only into H.O. Basni warehouse.' }); continue; }
    let lot = row.lotNo ? item.lots.find((entry) => normalName(entry.lotNo) === normalName(row.lotNo!)) : undefined;
    if (!lot && row.movementType === 'SALE_OUT') {
      const available = item.lots.map((entry) => ({ lot: entry, qty: listStockLedgerForLocation(location.id).find((stock) => stock.itemId === item.id && stock.lotId === entry.id)?.onHand ?? 0 })).filter((entry) => entry.qty > 0).sort((a, b) => new Date(a.lot.expiryDate ?? '9999-12-31').getTime() - new Date(b.lot.expiryDate ?? '9999-12-31').getTime());
      let remaining = row.quantity;
      for (const candidate of available) { if (remaining <= 0) break; const quantity = Math.min(remaining, candidate.qty); prepared.push({ row, item, locationId: location.id, lotId: candidate.lot.id, qtyDelta: -quantity }); remaining -= quantity; }
      if (remaining > 0) errors.push({ rowNumber: row.rowNumber, message: `${item.code} has insufficient stock at ${location.name}; ${remaining} cannot be deducted.` });
      continue;
    }
    let newLot: ReturnType<typeof ensureLotRecord> | undefined;
    if (!lot) {
      const lotNo = row.movementType === 'SALES_RETURN' ? `RETURN-${row.reference}` : (row.lotNo || 'LOT-DEFAULT');
      newLot = { id: `lot-sync-${item.id}-${normalName(lotNo)}`.slice(0, 180), itemId: item.id, lotNo, expiryDate: null, attributes: { source: row.movementType === 'SALES_RETURN' ? 'sales-return-import' : 'purchase-import' } };
      lot = newLot;
    }
    prepared.push({ row, item, locationId: location.id, lotId: lot.id, qtyDelta: row.movementType === 'SALE_OUT' ? -row.quantity : row.quantity, newLot });
  }
  return { errors, prepared, warehouse };
}

async function duplicateFileResponse(res: Response, companyId: string, existingId: string) {
  const existing = await getBatch(companyId, existingId);
  if (!existing) return res.status(409).json({ message: 'This file was already imported.' });
  const preview = await buildBatchPreviewPayload(companyId, existing.id);
  return res.status(409).json({
    message: duplicateConflictMessage(existing),
    batchToken: existing.id,
    status: existing.status,
    committedRows: existing.metadata?.committedRows ?? existing.validRows,
    preview,
  });
}

async function applyDailyLedger(movements: DailyMovementRecord[], lots: LotRecord[], checkpoints: Array<{ locationId: string; sourceType: 'SALES' | 'PURCHASE'; syncedThroughAt: string; lastImportBatchId: string }>, committedRows: number) {
  if (!committedRows) return;
  for (const lot of lots) ensureLotRecord(lot.itemId, lot.lotNo, lot.expiryDate, lot.attributes, lot.id);
  for (const movement of movements) {
    recordDailyMovement(movement);
    if (movement.lotId) adjustStockLedger(movement.itemId, movement.lotId, movement.locationId, movement.qtyDelta);
  }
  for (const checkpoint of checkpoints) upsertSyncCheckpoint(checkpoint);
}

function checkpointsFor(importType: 'SALES' | 'PURCHASE', batchId: string, movements: DailyMovementRecord[]) {
  const latestByLocation = new Map<string, string>();
  for (const movement of movements) {
    latestByLocation.set(movement.locationId, [latestByLocation.get(movement.locationId), movement.transactionAt].filter(Boolean).sort().at(-1)!);
  }
  return [...latestByLocation.entries()].map(([locationId, syncedThroughAt]) => ({ locationId, sourceType: importType, syncedThroughAt, lastImportBatchId: batchId }));
}

async function commitImportBatchToken(req: Request, res: Response, batchToken: string) {
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const batch = await getBatch(companyId, batchToken);
  if (!batch) return res.status(404).json({ message: 'Import batch was not found.' });
  if (batch.importedById !== req.user!.id && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Only the importer or Main Admin can commit this preview.' });
  }
  if (batch.status === 'POSTED') {
    return res.status(409).json({
      message: `Batch ${batch.id} is already posted.`,
      batchToken: batch.id,
      status: batch.status,
      committedRows: batch.metadata?.committedRows ?? batch.validRows,
    });
  }
  if (batch.status !== 'PREVIEWED' && batch.status !== 'VALIDATED') {
    return res.status(400).json({ message: `Batch ${batch.id} cannot be committed from ${batch.status}.` });
  }
  const counts = await countRowsByStatus(companyId, batch.id);
  if (counts.INVALID > 0 || counts.VALID === 0) {
    return res.status(400).json({ message: 'Fix all invalid or unmapped rows before confirming.', invalidRows: counts.INVALID, validRows: counts.VALID });
  }
  if (batch.status === 'PREVIEWED') await transitionBatch(companyId, batch.id, 'VALIDATED');
  const validRows = await listRows(companyId, batch.id, 'VALID');

  if (batch.type === 'SALES' || batch.type === 'PURCHASE') {
    const importType = batch.type;
    const { movements, lots } = movementsFromStagedDailyRows(batch.id, req.user!.id, importType, validRows);
    const checkpoints = checkpointsFor(importType, batch.id, movements);
    const persisted = await persistDailyMovementImport({
      batchId: batch.id,
      importType,
      fileName: batch.fileName,
      importedBy: req.user!.id,
      totalRows: batch.totalRows,
      invalidRows: batch.invalidRows,
      duplicateRows: batch.duplicateRows,
      transactionFrom: batch.sourceDateFrom ?? undefined,
      transactionTo: batch.sourceDateTo ?? undefined,
      movements,
      lots,
      checkpoints,
      fileHash: batch.fileHash ?? undefined,
      branchId: batch.branchId,
      sourceFormat: batch.sourceFormat,
      metadata: batch.metadata ?? undefined, companyId: req.companyId ?? DEFAULT_COMPANY_ID });
    await applyDailyLedger(movements, lots, checkpoints, persisted.committedRows);
    // Movements dated before an existing count make that count's book quantity stale.
    await applyLateMovementsQuietly(movements, req.user!.id);
    await completeBatchPosting(companyId, batch.id, { committedRows: persisted.committedRows });
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: `${importType}_IMPORT_COMMITTED`,
      entityType: 'ImportBatch',
      entityId: batch.id,
      metadata: { fileName: batch.fileName, rows: persisted.committedRows, batchToken: batch.id },
    }));
    return res.status(201).json({
      message: `${importType === 'PURCHASE' ? `Purchase received into ${String((batch.metadata as { purchaseWarehouse?: string } | null)?.purchaseWarehouse ?? 'H.O. Basni')}` : 'Sales and sales returns'} committed: ${persisted.committedRows} stock movements.`,
      batchId: batch.id,
      batchToken: batch.id,
      committedRows: persisted.committedRows,
    });
  }

  if (batch.type === 'OPENING_STOCK' || batch.type === 'ADJUSTMENT_SET') {
    const preview = openingPreviewFromStagedRows(batch, validRows);
    if (batch.type === 'OPENING_STOCK' && preview.format === 'invexa-expiry-stock' && req.body?.mode && req.body.mode !== 'replace-current') {
      return res.status(400).json({ message: 'Confirm replace-current mode after reviewing the preview.' });
    }
    if (preview.format === 'standard-items' && batch.type === 'OPENING_STOCK') {
      let created = 0;
      let updated = 0;
      const imported = [];
      for (const row of preview.validRows) {
        const result = await upsertCompanyItem({ code: row.code, name: row.itemName, category: row.category, subcategory: row.subcategory, company: row.companyName, unit: row.unit }, companyId);
        imported.push(result.item);
        if (result.created) created += 1;
        else updated += 1;
      }
      await transitionBatch(companyId, batch.id, 'POSTED', { committedRows: imported.length });
      const customValues = await saveImportedCustomValuesSafely(companyId, preview.validRows);
      return res.json({ message: `Imported ${imported.length} items (${created} new, ${updated} updated).`, imported, batchToken: batch.id, committedRows: imported.length, ...customValues });
    }
    const result = await persistOpeningStockImport(preview, batch.fileName, req.user!.id, { batchId: batch.id, fileHash: batch.fileHash ?? undefined, branchId: batch.branchId, companyId: req.companyId ?? DEFAULT_COMPANY_ID });
    await completeBatchPosting(companyId, batch.id, { committedRows: result.stockRows });
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: batch.type === 'OPENING_STOCK' ? 'OPENING_STOCK_IMPORTED' : 'STOCK_UPDATE_FILE_IMPORTED',
      entityType: 'ImportBatch',
      entityId: result.batchId,
      metadata: { fileName: batch.fileName, rows: result.stockRows, batchToken: batch.id, ...result },
    }));
    return res.status(201).json({
      message: batch.type === 'OPENING_STOCK'
        ? `Imported ${result.stockRows} branch/item/lot stock rows from ${preview.validRows.length} valid rows.`
        : `Set exact stock for ${result.stockRows} branch/item/lot rows.`,
      result,
      batchId: result.batchId,
      batchToken: batch.id,
      committedRows: result.stockRows,
    });
  }

  if (batch.type === 'ADJUSTMENT_ADD' || batch.type === 'ADJUSTMENT_REMOVE') {
    const mode = batch.type === 'ADJUSTMENT_ADD' ? 'ADD' : 'REMOVE';
    const fileHash = batch.fileHash ?? computeFileHash(Buffer.from(batch.id));
    const transactionAt = new Date().toISOString();
    const movements: DailyMovementRecord[] = [];
    const lots: LotRecord[] = [];
    validRows.forEach((row, index) => {
      const mapped = row.mappedData ?? {};
      const lotId = String(mapped.lotId ?? '');
      const itemId = String(mapped.itemId ?? '');
      const locationId = String(mapped.locationId ?? '');
      if (!lotId || !itemId || !locationId) return;
      if (mapped.isNewLot) {
        lots.push({
          id: lotId,
          itemId,
          lotNo: String(mapped.lotNo ?? 'LOT-DEFAULT'),
          expiryDate: typeof mapped.expiryDate === 'string' ? mapped.expiryDate : null,
          attributes: { source: 'bulk-stock-update' },
        });
      }
      movements.push({
        id: `move-${batch.id}-${index}`,
        dedupeKey: `ADJUSTMENT|${mode}|${fileHash}|${itemId}|${lotId}|${locationId}`,
        itemId,
        lotId,
        locationId,
        movementType: `BULK_${mode}`,
        qtyDelta: Number(mapped.qtyDelta),
        transactionAt,
        sourceType: 'ADJUSTMENT',
        sourceReference: batch.fileName,
        importBatchId: batch.id,
        createdById: req.user!.id,
        metadata: { sourceRow: row.rowNumber, mode, previousQty: mapped.currentQty, resultingQty: mapped.resultingQty },
      });
    });
    const persisted = await persistDailyMovementImport({
      batchId: batch.id,
      importType: batch.type,
      fileName: batch.fileName,
      importedBy: req.user!.id,
      totalRows: batch.totalRows,
      invalidRows: batch.invalidRows,
      duplicateRows: batch.duplicateRows,
      movements,
      lots,
      checkpoints: [],
      fileHash,
      branchId: batch.branchId,
      sourceFormat: batch.sourceFormat, companyId: req.companyId ?? DEFAULT_COMPANY_ID });
    await applyDailyLedger(movements, lots, [], persisted.committedRows);
    await completeBatchPosting(companyId, batch.id, { committedRows: persisted.committedRows });
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_UPDATE_FILE_IMPORTED', entityType: 'ImportBatch', entityId: batch.id, metadata: { fileName: batch.fileName, mode, rows: persisted.committedRows, fileHash } }));
    return res.status(201).json({
      message: persisted.committedRows ? `Updated ${persisted.committedRows} branch/item/lot stock rows.` : 'This exact file and mode were already applied; stock was not changed again.',
      batchId: batch.id,
      batchToken: batch.id,
      committedRows: persisted.committedRows,
    });
  }

  return res.status(400).json({ message: `Unsupported import type ${batch.type}.` });
}

async function previewDailyImport(req: Request, res: Response, importType: 'SALES' | 'PURCHASE') {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for daily imports.' });
  if (!req.file) return res.status(400).json({ message: 'Select an Excel or CSV file.' });
  try {
    const requestedDestination = importType === 'PURCHASE' ? requestedPurchaseDestination(req.companyId ?? DEFAULT_COMPANY_ID, req.body?.destinationLocationId) : undefined;
    const warehouse = requestedDestination ?? configuredPurchaseWarehouse(req.companyId ?? DEFAULT_COMPANY_ID);
    const fileHash = computeFileHash(req.file.buffer);
    const preview = await parseDailyStockImport(req.file.buffer, req.file.originalname, importType, { purchaseLocationName: warehouse?.name ?? 'H.O BASNI', purchaseTime: String(req.body.purchaseTime || '12:00') }, controlPlane.getImportProfile(req.companyId ?? DEFAULT_COMPANY_ID, importType));
    const existing = await findDuplicateBatch({
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      type: importType,
      fileHash,
      branchId: importType === 'PURCHASE' ? warehouse?.id ?? null : null,
      sourceDateFrom: preview.transactionFrom ?? null,
      sourceDateTo: preview.transactionTo ?? null,
    });
    if (existing) return duplicateFileResponse(res, req.companyId ?? DEFAULT_COMPANY_ID, existing.id);
    const plan = planDailyImport(preview, req.user!.id, req.companyId ?? DEFAULT_COMPANY_ID, requestedDestination);
    const staged = stageDailyImport(preview, plan);
    const batch = await createPreviewBatch({
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      type: importType,
      fileName: req.file.originalname,
      sourceFormat: 'daily-erp-export',
      importedById: req.user!.id,
      fileHash,
      branchId: importType === 'PURCHASE' ? warehouse?.id ?? null : null,
      sourceDateFrom: preview.transactionFrom ?? null,
      sourceDateTo: preview.transactionTo ?? null,
      totalRows: staged.length,
      validRows: staged.filter((row) => row.status === 'VALID').length,
      invalidRows: staged.filter((row) => row.status === 'INVALID').length,
      duplicateRows: staged.filter((row) => row.status === 'DUPLICATE').length,
      metadata: { sheetName: preview.sheetName, headerRow: preview.headerRow, mapping: preview.mapping, purchaseWarehouse: warehouse?.name },
      rows: staged,
    });
    return res.json({
      batchToken: batch.id,
      preview: {
        ...preview,
        batchToken: batch.id,
        status: batch.status,
        validRows: batch.validRows,
        invalidRows: batch.invalidRows,
        duplicateRows: batch.duplicateRows,
        errors: plan.errors.concat(preview.errors).slice(0, 100),
        sample: plan.prepared.slice(0, 20).map((entry) => ({
          ...entry.row,
          itemCode: entry.item.code,
          locationId: entry.locationId,
          qtyDelta: entry.qtyDelta,
          lotNo: entry.item.lots?.find((lot) => lot.id === entry.lotId)?.lotNo ?? entry.row.lotNo,
        })),
      },
    });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview import.' }); }
}

async function commitDailyImport(req: Request, res: Response, importType: 'SALES' | 'PURCHASE') {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access is required for daily imports.' });
  if (!req.file) return res.status(400).json({ message: 'Select an Excel or CSV file.' });
  try {
    const requestedDestination = importType === 'PURCHASE' ? requestedPurchaseDestination(req.companyId ?? DEFAULT_COMPANY_ID, req.body?.destinationLocationId) : undefined;
    const warehouse = requestedDestination ?? configuredPurchaseWarehouse(req.companyId ?? DEFAULT_COMPANY_ID); const preview = await parseDailyStockImport(req.file.buffer, req.file.originalname, importType, { purchaseLocationName: warehouse?.name ?? 'H.O BASNI', purchaseTime: String(req.body.purchaseTime || '12:00') }, controlPlane.getImportProfile(req.companyId ?? DEFAULT_COMPANY_ID, importType)); const plan = planDailyImport(preview, req.user!.id, req.companyId ?? DEFAULT_COMPANY_ID, requestedDestination);
    if (plan.errors.length || !plan.prepared.length) return res.status(400).json({ message: 'Fix all invalid or unmapped rows before confirming.', errors: plan.errors.slice(0, 100) });
    const batchId = `imp-${importType.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const movements = plan.prepared.map((entry, index) => ({ id: `move-${batchId}-${index}`, dedupeKey: `${entry.row.dedupeKey}|${entry.lotId}`, itemId: entry.item.id, lotId: entry.lotId, locationId: entry.locationId, movementType: entry.row.movementType, qtyDelta: entry.qtyDelta, transactionAt: entry.row.transactionAt, sourceType: importType, sourceReference: entry.row.reference, importBatchId: batchId, createdById: req.user!.id, metadata: { lineNo: entry.row.lineNo, sourceItemName: entry.row.itemName, rate: entry.row.rate, amount: entry.row.amount, timeAssumed: entry.row.timeAssumed, rowSource: entry.row.rowSource } }));
    const latestByLocation = new Map<string, string>(); for (const movement of movements) latestByLocation.set(movement.locationId, [latestByLocation.get(movement.locationId), movement.transactionAt].filter(Boolean).sort().at(-1)!);
    const checkpoints = [...latestByLocation.entries()].map(([locationId, syncedThroughAt]) => ({ locationId, sourceType: importType, syncedThroughAt, lastImportBatchId: batchId }));
    const persisted = await persistDailyMovementImport({ batchId, importType, fileName: req.file.originalname, importedBy: req.user!.id, totalRows: preview.totalRows, invalidRows: preview.errors.length, duplicateRows: preview.duplicateRows, transactionFrom: preview.transactionFrom, transactionTo: preview.transactionTo, movements, lots: plan.prepared.flatMap((entry) => entry.newLot ? [entry.newLot] : []), checkpoints, companyId: req.companyId ?? DEFAULT_COMPANY_ID });
    for (const entry of plan.prepared) if (entry.newLot) ensureLotRecord(entry.newLot.itemId, entry.newLot.lotNo, entry.newLot.expiryDate, entry.newLot.attributes, entry.newLot.id);
    for (const movement of movements) { recordDailyMovement(movement); adjustStockLedger(movement.itemId, movement.lotId!, movement.locationId, movement.qtyDelta); }
    for (const checkpoint of checkpoints) upsertSyncCheckpoint(checkpoint);
    await applyLateMovementsQuietly(movements, req.user!.id);
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: `${importType}_IMPORT_COMMITTED`, entityType: 'ImportBatch', entityId: batchId, metadata: { fileName: req.file.originalname, rows: persisted.committedRows, transactionFrom: preview.transactionFrom, transactionTo: preview.transactionTo, purchaseWarehouse: warehouse?.name } }));
    return res.status(201).json({ message: `${importType === 'PURCHASE' ? `Purchase received into ${warehouse?.name ?? 'H.O. Basni'}` : 'Sales and sales returns'} committed: ${persisted.committedRows} stock movements.`, batchId, committedRows: persisted.committedRows });
  } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to commit import.' }); }
}

router.post('/imports/sales/preview', upload.single('file'), (req, res) => previewDailyImport(req, res, 'SALES'));
router.post('/imports/sales/commit', upload.single('file'), (req, res) => commitDailyImport(req, res, 'SALES'));
router.post('/imports/purchases/preview', upload.single('file'), (req, res) => previewDailyImport(req, res, 'PURCHASE'));
router.post('/imports/purchases/commit', upload.single('file'), (req, res) => commitDailyImport(req, res, 'PURCHASE'));

export default router;

export const importsIntakeRouter = Router();
{
  const router = importsIntakeRouter;
// ---------------------------------------------------------------------------
// Warehouse transfer import, lot-aware picker sessions and bulk stock take
// ---------------------------------------------------------------------------

function exactItemMatch(itemCode: string | undefined, itemName: string | undefined, companyId: string) {
  // Code, barcode or ERP alias when a code is given (never falling back to
  // the name); otherwise a unique name or alias. Only the caller's own company's items are candidates: an upload
  // must never resolve to (and then plan stock moves for) an item that belongs to another company.
  return resolveItemByIdentity(itemsForCompany(companyId, listItems()), itemCode ? { code: itemCode } : { name: itemName }).item;
}

function transferImportPlan(preview: Awaited<ReturnType<typeof parseTransferImport>>, sourceLocationId: string, destinationLocationId: string, mergeDuplicates: boolean, companyId: string = DEFAULT_COMPANY_ID) {
  const errors = [...preview.errors];
  const sourceLedger = listStockLedgerForLocation(sourceLocationId);
  const destination = locationsForCompany(companyId, listLocations()).find((location) => location.id === destinationLocationId);
  const rows = mergeDuplicates
    ? [...preview.validRows.reduce((map, row) => {
        const key = (row.itemCode || row.itemName || '').trim().toLowerCase();
        const existing = map.get(key);
        if (existing) existing.requestedQty += row.requestedQty;
        else map.set(key, { ...row });
        return map;
      }, new Map<string, (typeof preview.validRows)[number]>()).values()]
    : preview.validRows;
  const mapped = [];
  for (const row of rows) {
    if (row.destinationStore && destination && ![destination.id, destination.name].some((value) => value.trim().toLowerCase() === row.destinationStore!.trim().toLowerCase())) {
      errors.push({ rowNumber: row.rowNumber, message: `Destination Store ${row.destinationStore} does not match selected destination ${destination.name}.` });
      continue;
    }
    const item = exactItemMatch(row.itemCode, row.itemName, companyId);
    if (!item) {
      errors.push({ rowNumber: row.rowNumber, message: row.itemCode ? `Unknown Item Code: ${row.itemCode}` : `Item Name is unknown or ambiguous: ${row.itemName}` });
      continue;
    }
    if (!isOperationalItem(item)) {
      errors.push({ rowNumber: row.rowNumber, message: inactiveImportMessage(item) });
      continue;
    }
    const lots = item.lots.map((lot) => ({
      lotId: lot.id,
      lotNo: lot.lotNo,
      expiryDate: lot.expiryDate,
      available: sourceLedger.find((entry) => entry.itemId === item.id && entry.lotId === lot.id)?.onHand ?? 0,
      status: lot.status ?? 'AVAILABLE',
    }));
    const workflow = getActiveWorkflow(companyId);
    if (workflow.expiryBlocking && lots.every((lot) => lot.status !== 'AVAILABLE' || (lot.expiryDate && new Date(lot.expiryDate).getTime() < Date.now()))) {
      errors.push({ rowNumber: row.rowNumber, message: `${item.code} has no allocatable lots while expiry blocking is on.` });
      continue;
    }
    const allocated = allocateLots(lots, row.requestedQty, workflow.allocationStrategy);
    if (allocated.shortage > 0) {
      errors.push({ rowNumber: row.rowNumber, message: `${item.code} has ${row.requestedQty - allocated.shortage} available; ${row.requestedQty} requested.` });
      continue;
    }
    mapped.push({ ...row, item, allocations: allocated.allocations, totalAvailable: lots.reduce((sum, lot) => sum + lot.available, 0) });
  }
  return { mapped, errors };
}

router.post('/transfers/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Only admins can import transfers.' });
  if (!req.file || !req.body.sourceLocationId || !req.body.destinationLocationId) return res.status(400).json({ message: 'File, source and destination are required.' });
  try {
    const preview = await parseTransferImport(req.file.buffer, req.file.originalname);
    const plan = transferImportPlan(preview, req.body.sourceLocationId, req.body.destinationLocationId, req.body.mergeDuplicates !== 'false', req.companyId ?? DEFAULT_COMPANY_ID);
    return res.json({ preview: {
      sheetName: preview.sheetName, headerRow: preview.headerRow, totalRows: preview.totalRows,
      validRows: plan.mapped.length, invalidRows: plan.errors.length, duplicateRows: preview.duplicateRows,
      mapping: preview.mapping, rows: plan.mapped.slice(0, 50).map(({ item, allocations, ...row }) => ({ ...row, itemId: item.id, itemCode: item.code, itemName: item.name, allocations })),
      errors: plan.errors.slice(0, 100),
    } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview transfer.' });
  }
});

router.post('/transfers/import/commit', upload.single('file'), async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Only admins can import transfers.' });
  if (!req.file || !req.body.sourceLocationId || !req.body.destinationLocationId) return res.status(400).json({ message: 'File, source and destination are required.' });
  if (req.body.sourceLocationId === req.body.destinationLocationId) return res.status(400).json({ message: 'Source and destination must differ.' });
  try {
    const preview = await parseTransferImport(req.file.buffer, req.file.originalname);
    const plan = transferImportPlan(preview, req.body.sourceLocationId, req.body.destinationLocationId, req.body.mergeDuplicates !== 'false', req.companyId ?? DEFAULT_COMPANY_ID);
    if (plan.errors.length || !plan.mapped.length) return res.status(400).json({ message: 'Fix all unmapped or insufficient-stock rows before confirming.', errors: plan.errors.slice(0, 100) });
    const transfer: TransferRecord = {
      id: `transfer-${Math.random().toString(36).slice(2, 10)}`,
      sourceLocationId: req.body.sourceLocationId,
      destinationLocationId: req.body.destinationLocationId,
      requestedBy: req.user!.id,
      role: 'ADMIN',
      status: 'PENDING_PICK',
      lines: plan.mapped.flatMap(({ item, allocations }) => allocations.map((allocation) => ({ itemId: item.id, lotId: allocation.lotId, quantity: allocation.quantity }))),
      notes: `Imported from ${req.file.originalname}`,
      createdAt: new Date().toISOString(),
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    };
    createTransferRecord(transfer);
    await persistTransfer(transfer, req.companyId ?? DEFAULT_COMPANY_ID);
    await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'TRANSFER_IMPORTED', entityType: 'Transfer', entityId: transfer.id, metadata: { fileName: req.file.originalname, sourceLocationId: transfer.sourceLocationId, destinationLocationId: transfer.destinationLocationId, rows: preview.totalRows, duplicateRows: preview.duplicateRows, mergeDuplicates: req.body.mergeDuplicates !== 'false' } }));
    return res.status(201).json({ message: `Transfer ${transfer.id} released to picker with ${transfer.lines.length} FEFO lot allocations.`, transfer });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to import transfer.' });
  }
});

router.post('/stock-takes/preview-by-filters', (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Only admins and branch managers can prepare bulk stock take.' });
  const { locationId, category = 'all', subcategory = 'all', company = 'all', search = '' } = req.body;
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot prepare a stock take at the selected location.' });
  }
  const ledger = listStockLedgerForLocation(locationId);
  const quantityByItem = new Map<string, number>();
  for (const row of ledger) quantityByItem.set(row.itemId, (quantityByItem.get(row.itemId) ?? 0) + row.onHand);
  // The filter choices and the zero-stock count come from the caller's own company's items only; the process-wide list
  // put other companies' category, sub-category and brand names into the response.
  const ownItems = itemsForCompany(req.companyId ?? DEFAULT_COMPANY_ID, listItems());
  const all = ownItems.filter((item) =>
    (category === 'all' || item.category === category)
    && (subcategory === 'all' || item.subcategory === subcategory)
    && (company === 'all' || item.company === company)
    && (!search || `${item.code} ${item.name}`.toLowerCase().includes(String(search).toLowerCase())),
  );
  const items = all.filter((item) => (quantityByItem.get(item.id) ?? 0) > 0).map((item) => ({ ...item, availableStock: quantityByItem.get(item.id) ?? 0 }));
  return res.json({ items, matchingCount: items.length, excludedZeroStock: all.length - items.length, filters: { categories: [...new Set(ownItems.map((item) => item.category).filter(Boolean))], subcategories: [...new Set(ownItems.map((item) => item.subcategory).filter(Boolean))], companies: [...new Set(ownItems.map((item) => item.company).filter(Boolean))] } });
});

router.post('/stock-takes/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Only admins and branch managers can import stock-take lists.' });
  if (!req.file || !req.body.locationId) return res.status(400).json({ message: 'File and locationId are required.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), req.body.locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot import a stock take at the selected location.' });
  }
  try {
    const { rows } = await readTabularFile(req.file.buffer, req.file.originalname);
    const header = rows.findIndex((row) => row.some((cell) => ['itemcode', 'itemname'].includes(String(cell ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ''))));
    if (header < 0) throw new Error('Item Code or Item Name header was not found.');
    const normalized = rows[header].map((cell) => String(cell ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
    const codeIndex = normalized.indexOf('itemcode'); const nameIndex = normalized.indexOf('itemname');
    const ledger = listStockLedgerForLocation(req.body.locationId); const seen = new Set<string>(); const items = []; const errors = [];
    for (let index = header + 1; index < rows.length; index += 1) {
      const code = codeIndex >= 0 ? String(rows[index][codeIndex] ?? '').trim() : '';
      const name = nameIndex >= 0 ? String(rows[index][nameIndex] ?? '').trim() : '';
      if (!code && !name) continue;
      const item = exactItemMatch(code || undefined, name || undefined, req.companyId ?? DEFAULT_COMPANY_ID);
      if (!item) { errors.push({ rowNumber: index + 1, message: code ? `Unknown Item Code: ${code}` : `Unknown or ambiguous Item Name: ${name}` }); continue; }
      if (!isOperationalItem(item)) { errors.push({ rowNumber: index + 1, message: inactiveImportMessage(item) }); continue; }
      if (seen.has(item.id)) continue; seen.add(item.id);
      const availableStock = ledger.filter((row) => row.itemId === item.id).reduce((sum, row) => sum + row.onHand, 0);
      if (availableStock <= 0) { errors.push({ rowNumber: index + 1, message: `${item.code} excluded because available stock is zero.` }); continue; }
      items.push({ ...item, availableStock });
    }
    return res.json({ preview: { items, validRows: items.length, invalidRows: errors.length, errors: errors.slice(0, 100) } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to preview stock-take import.' });
  }
});

router.post('/stock-takes/bulk-assign', async (req: Request, res: Response) => {
  if (!canManageCountWork(req.user!.role)) return res.status(403).json({ message: 'Only admins and branch managers can assign stock takes.' });
  const { locationId, storeUserId, itemIds, countDate, dueDate, priority, instructions, filterSnapshot } = req.body;
  if (!locationId || !storeUserId || !Array.isArray(itemIds) || !itemIds.length) return res.status(400).json({ message: 'Location, Store User and selected items are required.' });
  try {
    assertCountLocationAccess(accessContext(req.user!), locationId);
  } catch {
    return res.status(403).json({ message: 'This user cannot assign stock takes at the selected location.' });
  }
  const user = findUserById(storeUserId);
  if (!user || !isCountWorkerRole(user.role) || !user.assignedLocationIds.includes(locationId)) return res.status(400).json({ message: 'Selected count worker is not assigned to this location.' });
  let parsedDueDate: string | undefined;
  let parsedPriority;
  try {
    parsedDueDate = parseOptionalDueDate(dueDate);
    parsedPriority = parseCountPriority(priority);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid assignment payload.' });
  }
  const ledger = listStockLedgerForLocation(locationId); const deduped = [...new Set(itemIds)]; const excluded = []; const eligible = [];
  for (const itemId of deduped) {
    const available = ledger.filter((row) => row.itemId === itemId).reduce((sum, row) => sum + row.onHand, 0);
    if (available <= 0 || inactiveItemMessage([itemId])) excluded.push(itemId); else eligible.push(itemId);
  }
  const assignments = eligible.map((itemId) => createCountAssignment({ id: `assign-${Math.random().toString(36).slice(2, 10)}`, locationId, itemId, assignedToId: storeUserId, assignedById: req.user!.id, countDate: countDate ? new Date(countDate).toISOString() : new Date().toISOString(), dueDate: parsedDueDate, priority: parsedPriority, instructions }));
  await Promise.all(assignments.map(persistCountAssignment));
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'STOCK_TAKE_BULK_ASSIGNED', entityType: 'CountAssignment', entityId: assignments[0]?.id ?? 'none', metadata: { locationId, storeUserId, itemIds: eligible, excludedZeroStock: excluded, filterSnapshot } }));
  return res.status(201).json({ message: `Assigned ${assignments.length} in-stock items.`, assignments, excludedZeroStock: excluded });
});

// ---------------------------------------------------------------------------
// Transfer label printing and reprint audit
// ---------------------------------------------------------------------------

// Transfer label and reprint-audit routes moved to routes/transfer-labels.ts
}
