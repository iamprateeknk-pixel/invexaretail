// Item catalog, stock read and item-photo routes for core (Phase 4):
// extracted verbatim from core.ts; the composer mounts these
// routers at the clusters' original registration positions.
import { saveItemPhoto, listItemPhotos, readItemPhoto, deleteItemPhoto } from '../lib/item-photos.js';
import { type Request, type Response, Router } from 'express';
import { evidenceMime } from '../lib/transfer-evidence.js';
import { DEFAULT_COMPANY_ID, itemsForCompany, registerItemCompany } from '../lib/saas/tenant-scope.js';
import { canAccessLocation, sanitizeStockForRole, hidesZeroStockForRole, parseItemOperationalMeta, type ItemOperationalMeta } from '../lib/inventory.js';
import { createInventoryItem } from '../lib/store.js';
import { createItemRecord, updateItemRecord, listItems, listStockLedgerForLocation, users } from '../lib/repository.js';
import { recordAudit } from '../lib/audit.js';
import { findIdentityConflict, isOperationalItem, parseItemMasterFields, parseStatusFilter, seesInactiveItems, visibleItems } from '../lib/item-master.js';
import { databaseEnabled, listStockFromDatabase, persistAudit, persistItem } from '../lib/persistence.js';
import { prisma } from '../lib/db.js';
import { listItemsForCompany } from '../lib/repositories/item-repository.js';
import { accessContext, tenantContext, firstParam, isOperationalAdmin, upload } from './core-shared.js';

const router = Router();

router.get('/items', async (req: Request, res: Response) => {
  let filter;
  try {
    filter = parseStatusFilter(req.query.status);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid status filter.' });
  }
  // Operational users only ever see ACTIVE items; admins can ask for
  // ARCHIVED / all to maintain the master (blueprint v4 §6).
  // Database-first slice 6: read through the scoped item repository (Postgres in database mode). The web app
  // gates this behind GET /items/version, so it only runs when the catalogue actually changed.
  return res.json({ items: visibleItems(req.user!.role, await listItemsForCompany(tenantContext(req)), filter) });
});

router.post('/items', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can create items.' });
  }
  if (typeof req.body.code !== 'string' || !req.body.code.trim() || typeof req.body.name !== 'string' || !req.body.name.trim()) {
    return res.status(400).json({ message: 'Item Code and Item Name are required.' });
  }
  let operationalMeta: ItemOperationalMeta;
  let masterFields: ReturnType<typeof parseItemMasterFields>;
  try {
    operationalMeta = parseItemOperationalMeta(req.body);
    masterFields = parseItemMasterFields(req.body);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid item fields.' });
  }
  // Codes, barcodes and aliases are unique per company (the database enforces (companyId, code)). Checking the process-wide
  // list refused a code another company uses and put that company's item code and name in the 409 message.
  const ownItems = itemsForCompany(req.companyId ?? DEFAULT_COMPANY_ID, listItems());
  const claimConflict = findIdentityConflict(ownItems, '', { code: req.body.code, barcode: masterFields.barcode, aliases: masterFields.aliases });
  if (claimConflict) return res.status(409).json({ message: claimConflict });
  try {
    const item = createInventoryItem({
      code: req.body.code,
      name: req.body.name,
      category: req.body.category,
      subcategory: req.body.subcategory,
      company: req.body.company,
      unit: req.body.unit,
      ...operationalMeta,
    });
    const saved = createItemRecord({ code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, unit: item.unit, ...operationalMeta, ...masterFields, createdById: req.user!.id });
    registerItemCompany(saved.id, req.companyId ?? DEFAULT_COMPANY_ID);
    await persistItem(saved, req.companyId ?? DEFAULT_COMPANY_ID);
    await persistAudit(recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: 'ITEM_CREATED',
      entityType: 'Item',
      entityId: saved.id,
    }));
    return res.status(201).json({ success: true, item: saved });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to create item' });
  }
});

router.put('/items/:itemId', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const itemId = firstParam(req.params.itemId);
  const item = listItems().find((candidate) => candidate.id === itemId);
  if (!item) return res.status(404).json({ message: 'Item was not found.' });
  const nextCode = typeof req.body.code === 'string' ? req.body.code.trim() : item.code;
  const nextName = typeof req.body.name === 'string' ? req.body.name.trim() : item.name;
  if (!nextCode || !nextName) return res.status(400).json({ message: 'Item Code and Item Name are required.' });
  const ownItems = itemsForCompany(req.companyId ?? DEFAULT_COMPANY_ID, listItems());
  if (ownItems.some((candidate) => candidate.id !== item.id && candidate.code.trim().toLowerCase() === nextCode.toLowerCase())) {
    return res.status(409).json({ message: 'Another item already uses this Item Code.' });
  }
  let operationalMeta: ItemOperationalMeta;
  let masterFields: ReturnType<typeof parseItemMasterFields>;
  try {
    operationalMeta = parseItemOperationalMeta(req.body);
    masterFields = parseItemMasterFields(req.body);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid item fields.' });
  }
  const claimConflict = findIdentityConflict(ownItems, item.id, {
    code: nextCode !== item.code ? nextCode : undefined,
    barcode: masterFields.barcode,
    aliases: masterFields.aliases,
  });
  if (claimConflict) return res.status(409).json({ message: claimConflict });
  const patch = {
    code: nextCode,
    name: nextName,
    category: req.body.category === undefined ? item.category : String(req.body.category || '').trim() || undefined,
    subcategory: req.body.subcategory === undefined ? item.subcategory : String(req.body.subcategory || '').trim() || undefined,
    company: req.body.company === undefined ? item.company : String(req.body.company || '').trim() || undefined,
    unit: req.body.unit === undefined ? item.unit : String(req.body.unit || '').trim() || undefined,
    ...operationalMeta,
    ...masterFields,
    version: (item.version ?? 1) + 1,
    updatedById: req.user!.id,
  };
  // Write to the stored record (item is only a copy) so the change is
  // visible to every later request, not just this response.
  const updated = updateItemRecord(item.id, patch)!;
  await persistItem(updated);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'ITEM_UPDATED', entityType: 'Item', entityId: updated.id, metadata: { code: updated.code, name: updated.name } }));
  return res.json({ item: updated });
});

router.put('/items/:itemId/lots/:lotId', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const item = listItems().find((candidate) => candidate.id === firstParam(req.params.itemId));
  const lot = item?.lots.find((candidate) => candidate.id === firstParam(req.params.lotId));
  if (!item || !lot) return res.status(404).json({ message: 'Item lot was not found.' });
  const lotNo = typeof req.body.lotNo === 'string' ? req.body.lotNo.trim() : lot.lotNo;
  if (!lotNo) return res.status(400).json({ message: 'Lot Code is required.' });
  if (item.lots.some((candidate) => candidate.id !== lot.id && candidate.lotNo.trim().toLowerCase() === lotNo.toLowerCase())) {
    return res.status(409).json({ message: 'This item already has the same Lot Code.' });
  }
  lot.lotNo = lotNo;
  if (req.body.expiryDate !== undefined) {
    const parsed = req.body.expiryDate ? new Date(req.body.expiryDate) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return res.status(400).json({ message: 'Expiry date is invalid.' });
    lot.expiryDate = parsed?.toISOString() ?? null;
  }
  lot.attributes = { ...(lot.attributes ?? {}), ...(req.body.attributes && typeof req.body.attributes === 'object' ? req.body.attributes : {}) };
  await persistItem(item);
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: 'LOT_UPDATED', entityType: 'Lot', entityId: lot.id, metadata: { itemId: item.id, lotNo: lot.lotNo, expiryDate: lot.expiryDate } }));
  return res.json({ item, lot });
});

// ============================================
// STOCK
// ============================================

router.get('/stock/:locationId', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const locationId = firstParam(req.params.locationId);

  if (!canAccessLocation(context, locationId)) {
    return res.status(403).json({ message: 'Location access denied for this role.' });
  }

  const rows = databaseEnabled
    ? await listStockFromDatabase(locationId)
    : listStockLedgerForLocation(locationId).map((row) => ({
        itemId: row.itemId,
        lotId: row.lotId,
        locationId: row.locationId,
        bookQuantity: row.onHand,
        physicalQuantity: row.onHand,
        variance: 0,
        stockValue: 0,
        quarantineQuantity: row.quarantine,
        damagedQuantity: 0,
        // Reservations are DB-only (see lib/reservation.ts) - memory mode
        // has no concurrent requests to race, so nothing is ever reserved.
        reservedQuantity: 0,
        availableQuantity: row.onHand,
      }));

  const activeItemIds = new Set(listItems().filter(isOperationalItem).map((item) => item.id));
  const visibleRows = (hidesZeroStockForRole(context.role)
    ? rows.filter((row) => row.availableQuantity > 0)
    : rows
  ).filter((row) => seesInactiveItems(context.role) || activeItemIds.has(row.itemId));

  return res.json({ locationId, items: visibleRows.map((row) => sanitizeStockForRole(context.role, row)) });
});

export default router;

export const itemPhotosRouter = Router();
{
  const router = itemPhotosRouter;
// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

// An item photo is only reachable through an item of the caller's own company. A foreign item id
// looks exactly like a missing one (404).
async function callerOwnsItem(req: Request, itemId: string): Promise<boolean> {
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  if (databaseEnabled) {
    return Boolean(await prisma.item.findFirst({ where: { id: itemId, companyId }, select: { id: true } }).catch(() => null));
  }
  return itemsForCompany(companyId, listItems()).some((candidate) => candidate.id === itemId);
}

router.post('/items/:itemId/photos', upload.single('photo'), async (req: Request, res: Response) => {
  const itemId = firstParam(req.params.itemId);
  if (!(await callerOwnsItem(req, itemId))) {
    return res.status(404).json({ message: 'Item was not found.' });
  }
  if (!isOperationalAdmin(req.user!.role) && req.user!.role !== 'STORE_USER' && req.user!.role !== 'WAREHOUSE_PICKER') {
    return res.status(403).json({ message: 'Item photo upload access denied.' });
  }
  if (!req.file) return res.status(400).json({ message: 'Photo file is required.' });
  try { evidenceMime(req.file.buffer); }
  catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid photo.' }); }
  try {
    const photo = await saveItemPhoto(itemId, req.user!.id, req.file.originalname, req.file.buffer, req.body?.primary === 'true');
    return res.status(201).json({ success: true, photo });
  } catch {
    return res.status(503).json({ message: 'Photo was not saved. Check database storage and retry.' });
  }
});

router.get('/items/:itemId/photos', async (req: Request, res: Response) => {
  const itemId = firstParam(req.params.itemId);
  if (!(await callerOwnsItem(req, itemId))) {
    return res.status(404).json({ message: 'Item was not found.' });
  }
  try { return res.json({ photos: await listItemPhotos(itemId) }); }
  catch { return res.status(503).json({ message: 'Photo storage unavailable.' }); }
});

router.get('/items/:itemId/photos/:photoId', async (req: Request, res: Response) => {
  const itemId = firstParam(req.params.itemId);
  if (!(await callerOwnsItem(req, itemId))) return res.status(404).json({ message: 'Photo was not found.' });
  try {
    const photo = await readItemPhoto(itemId, firstParam(req.params.photoId));
    if (!photo) return res.status(404).json({ message: 'Photo was not found.' });
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.type(photo.mimeType).send(Buffer.from(photo.contents));
  } catch { return res.status(503).json({ message: 'Photo storage unavailable.' }); }
});

router.delete('/items/:itemId/photos/:photoId', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const itemId = firstParam(req.params.itemId);
  if (!(await callerOwnsItem(req, itemId))) return res.status(404).json({ message: 'Photo was not found.' });
  try {
    await deleteItemPhoto(itemId, firstParam(req.params.photoId));
    return res.json({ success: true });
  } catch { return res.status(503).json({ message: 'Photo storage unavailable.' }); }
});

// Transfer evidence routes (POST/GET /transfers/:transferId/evidence[/:evidenceId])
// moved to routes/transfer-evidence.ts (docs/route-ownership-matrix.md).
}
