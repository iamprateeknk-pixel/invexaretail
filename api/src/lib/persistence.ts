import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma, resolveDatabaseUrl } from './db.js';
import type { CompanyProfileRecord, CountAssignmentRecord, CountRecord, ItemRecord, LocationRecord, TransferRecord, UserRecord } from './repository.js';
import type { AuditEvent } from './audit.js';
import { companyProfile, counts, countAssignments, dailyMovements, items, locations, setCompanyProfile, stockLedger, syncCheckpoints, transfers, users } from './repository.js';
import { enhancedUsers } from './enterprise-repository.js';
import type { Role } from './inventory.js';
import { aggregateOpeningStock, type StockImportPreview } from './stock-import.js';
import type { DailyMovementRecord, LotRecord, SyncCheckpointRecord } from './repository.js';
import { hydrateActiveWorkflow } from './industry-packs.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID, adoptHydratedOwnership, registerItemCompany, registerLocationCompany } from './saas/tenant-scope.js';

export const databaseEnabled = Boolean(resolveDatabaseUrl());

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
  assignedLocationIds: string[];
};

const demoUsers: Record<string, AuthenticatedUser> = {
  'admin@retail.local': { id: 'user-admin-1', email: 'admin@retail.local', role: 'ADMIN', assignedLocationIds: ['loc-1', 'loc-2', 'wh-1'] },
  'manager@retail.local': { id: 'user-manager-1', email: 'manager@retail.local', role: 'BRANCH_MANAGER', assignedLocationIds: ['loc-1'] },
  'store@retail.local': { id: 'user-store-1', email: 'store@retail.local', role: 'STORE_USER', assignedLocationIds: ['loc-1'] },
  'picker@retail.local': { id: 'user-picker-1', email: 'picker@retail.local', role: 'WAREHOUSE_PICKER', assignedLocationIds: ['wh-1'] },
  'auditor@retail.local': { id: 'user-auditor-1', email: 'auditor@retail.local', role: 'AUDITOR', assignedLocationIds: ['loc-1'] },
};

function parseAssignedLocations(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    // Legacy Hostinger rows can contain blank or malformed assignment data.
    // Authentication must remain available; an admin can repair assignments.
    return [];
  }
}

export async function authenticateUser(email: string, password: string, requestedRole?: Role): Promise<AuthenticatedUser> {
  if (!databaseEnabled) {
    const user = demoUsers[email.toLowerCase()];
    const developmentPassword = process.env.SEED_PASSWORD;
    if (!developmentPassword || !user || password !== developmentPassword) throw new Error('Invalid email or password.');
    if (requestedRole && requestedRole !== user.role) throw new Error('Requested role does not match the user.');
    return user;
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new Error('Invalid email or password.');
  return {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    assignedLocationIds: parseAssignedLocations(user.assignedLocations),
  };
}

export type PersistedStockRow = {
  itemId: string;
  lotId: string;
  locationId: string;
  bookQuantity: number;
  physicalQuantity: number;
  variance: number;
  stockValue: number;
  quarantineQuantity: number;
  damagedQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
};

function requireDatabase(): void {
  if (!databaseEnabled) {
    throw new Error('Database persistence is disabled. Set DATABASE_URL to the Hostinger MySQL database.');
  }
}

export async function hydrateRepositoryFromDatabase(): Promise<void> {
  if (!databaseEnabled) return;

  const [dbLocations, dbItems, dbCounts, dbTransfers, dbStockLedger, dbAssignments, dbUsers] = await Promise.all([
    prisma.location.findMany(),
    prisma.item.findMany({ include: { lots: true } }),
    prisma.stockCount.findMany(),
    prisma.transfer.findMany({ include: { lines: true } }),
    prisma.stockLedger.findMany(),
    prisma.countAssignment.findMany(),
    prisma.user.findMany(),
  ]);

  locations.splice(0, locations.length, ...dbLocations.map((location) => ({
    id: location.id,
    name: location.name,
    type: location.type as 'store' | 'warehouse',
  })));

  items.splice(0, items.length, ...dbItems.map((item: any) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category ?? undefined,
    subcategory: item.subcategory ?? undefined,
    company: item.company ?? undefined,
    unit: item.unit ?? undefined,
    lots: item.lots.map((lot) => ({
      id: lot.id,
      itemId: lot.itemId,
      lotNo: lot.lotNo,
      expiryDate: lot.expiryDate?.toISOString() ?? null,
      status: (lot.status as 'AVAILABLE' | 'EXPIRED' | 'BLOCKED' | 'QUARANTINE') ?? 'AVAILABLE',
      attributes: (lot.attributes as Record<string, unknown> | null) ?? undefined,
    })),
  })));

  adoptHydratedOwnership({
    locations: dbLocations.map((location) => ({ id: location.id, companyId: (location as { companyId?: string }).companyId })),
    items: dbItems.map((item) => ({ id: item.id, companyId: (item as { companyId?: string }).companyId })),
  });

  counts.splice(0, counts.length, ...dbCounts.map((count) => ({
    id: count.id,
    itemId: count.itemId,
    lotId: count.lotId,
    locationId: count.locationId,
    physicalQuantity: count.physicalQty,
    bookQty: count.bookQty,
    mode: count.mode as 'scan' | 'manual',
    submittedBy: count.submittedById,
    role: 'STORE_USER' as const,
    createdAt: count.createdAt.toISOString(),
    status: count.reviewStatus as 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW' | 'RECOUNT',
    reviewedBy: count.approvedById ?? undefined,
    reviewedAt: count.approvedAt?.toISOString(),
    reviewReason: count.reviewReason ?? undefined,
    parentCountId: count.parentCountId ?? undefined,
  })));

  stockLedger.splice(0, stockLedger.length, ...dbStockLedger.map((row) => ({
    itemId: row.itemId,
    lotId: row.lotId,
    locationId: row.locationId,
    onHand: row.onHand,
    quarantine: row.quarantine,
    version: row.version,
  })));

  users.splice(0, users.length, ...dbUsers.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    assignedLocationIds: parseAssignedLocations(user.assignedLocations),
  })));

  countAssignments.splice(0, countAssignments.length, ...dbAssignments.map((row) => ({
    id: row.id,
    locationId: row.locationId,
    itemId: row.itemId,
    assignedToId: row.assignedToId,
    assignedById: row.assignedById,
    countDate: row.countDate.toISOString(),
    dueDate: row.dueDate?.toISOString(),
    priority: (row.priority as CountAssignmentRecord['priority']) || 'NORMAL',
    instructions: row.instructions ?? undefined,
    status: row.status,
    countId: row.countId ?? undefined,
    parentCountId: row.parentCountId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  })));

  transfers.splice(0, transfers.length, ...dbTransfers.map((transfer) => ({
    id: transfer.id,
    sourceLocationId: transfer.sourceLocationId,
    destinationLocationId: transfer.destinationLocationId,
    requestedBy: transfer.requestedById,
    role: 'ADMIN' as const,
    status: transfer.status,
    cartonCount: transfer.cartonCount ?? undefined,
    notes: transfer.notes ?? undefined,
    lines: transfer.lines.map((line: any) => ({ itemId: line.itemId, lotId: line.lotId, quantity: line.requestedQty, receivedQty: line.receivedQty, damagedQty: line.damagedQty, shortageQty: line.shortageQty ?? 0 })),
    createdAt: transfer.createdAt.toISOString(),
  })));

  // These tables were introduced after the original Hostinger deployment.
  // Keep startup compatible while the migration is pending, then hydrate them
  // normally once present so sync state survives an API restart.
  try {
    const [dbMovements, dbCheckpoints] = await Promise.all([
      prisma.inventoryMovement.findMany({ orderBy: { transactionAt: 'desc' }, take: 10_000 }),
      prisma.syncCheckpoint.findMany(),
    ]);
    dailyMovements.splice(0, dailyMovements.length, ...dbMovements.map((row) => ({
      id: row.id,
      dedupeKey: row.dedupeKey,
      itemId: row.itemId,
      lotId: row.lotId ?? undefined,
      locationId: row.locationId,
      movementType: row.movementType,
      qtyDelta: row.qtyDelta,
      transactionAt: row.transactionAt.toISOString(),
      sourceType: row.sourceType as DailyMovementRecord['sourceType'],
      sourceReference: row.sourceReference,
      importBatchId: row.importBatchId ?? undefined,
      createdById: row.createdById,
      metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    })));
    syncCheckpoints.splice(0, syncCheckpoints.length, ...dbCheckpoints
      .filter((row) => row.sourceType === 'SALES' || row.sourceType === 'PURCHASE')
      .map((row) => ({
        locationId: row.locationId,
        sourceType: row.sourceType as SyncCheckpointRecord['sourceType'],
        syncedThroughAt: row.syncedThroughAt.toISOString(),
        lastImportBatchId: row.lastImportBatchId ?? '',
      })));
  } catch (error) {
    console.warn('Daily sync tables are not available yet; run the Hostinger migration.', error instanceof Error ? error.message : error);
  }
}

export async function hydrateAuditFromDatabase(): Promise<AuditEvent[]> {
  if (!databaseEnabled) return [];
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function loadTransferPickSlips(transferId: string): Promise<AuditEvent[]> {
  if (!databaseEnabled) return [];
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'Transfer', entityId: transferId, action: 'PICK_SLIP_SAVED' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function persistItem(item: ItemRecord, companyId = 'default-company'): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.item.upsert({
    where: { id: item.id },
    update: { code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, unit: item.unit } as any,
    create: { id: item.id, code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, companyId, tenantId: DEFAULT_TENANT_ID, unit: item.unit } as any,
  });
  for (const lot of item.lots) {
    await prisma.lot.upsert({
      where: { id: lot.id },
      update: { lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes as Prisma.InputJsonValue },
      create: { id: lot.id, itemId: lot.itemId, lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes as Prisma.InputJsonValue },
    });
  }
}

function importId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha1').update(value.trim().toLowerCase()).digest('hex').slice(0, 20)}`;
}

export type StockImportCommitResult = {
  batchId: string;
  importedItems: number;
  importedLots: number;
  importedLocations: number;
  stockRows: number;
};

/**
 * Commits a validated opening-stock workbook as an immutable snapshot and sets
 * current on-hand for each matching location/item/lot. IDs are deterministic,
 * so retrying after a network interruption cannot create duplicate masters.
 */
export async function persistOpeningStockImport(
  preview: StockImportPreview,
  fileName: string,
  importedBy: string,
  options?: { batchId?: string; fileHash?: string; branchId?: string | null; companyId?: string },
): Promise<StockImportCommitResult> {
  const companyId = options?.companyId || 'default-company';
  const rows = aggregateOpeningStock(preview.validRows);
  const locationMap = new Map(locations.map((row) => [row.name.trim().toLowerCase(), row]));
  const itemCodeMap = new Map(items.map((row) => [row.code.trim().toLowerCase(), row]));
  const itemNameMap = new Map(items.map((row) => [`${(row.category ?? '').trim().toLowerCase()}|${row.name.trim().toLowerCase()}`, row]));
  const newLocations: LocationRecord[] = [];
  const newItems: ItemRecord[] = [];
  const touchedItems = new Map<string, ItemRecord>();
  const newLots: ItemRecord['lots'] = [];
  const lotMap = new Map(items.flatMap((item) => item.lots.map((lot) => [`${item.id}|${lot.lotNo.trim().toLowerCase()}`, lot] as const)));
  const prepared = rows.map((row) => {
    const locationKey = row.locationName!.trim().toLowerCase();
    let location = locationMap.get(locationKey);
    if (!location) {
      const normalizedLocation = row.locationName!.toLowerCase().replace(/[^a-z0-9]+/g, '');
      location = { id: importId('loc-erp', locationKey), name: row.locationName!, type: normalizedLocation === 'hobasni' || normalizedLocation === 'basni' ? 'warehouse' : 'store' };
      locationMap.set(locationKey, location);
      newLocations.push(location);
    }

    const nameKey = `${(row.category ?? '').trim().toLowerCase()}|${row.itemName.trim().toLowerCase()}`;
    let item = itemCodeMap.get(row.code.toLowerCase()) ?? itemNameMap.get(nameKey);
    if (!item) {
      item = { id: importId('item-erp', row.code), code: row.code, name: row.itemName, category: row.category, subcategory: row.subcategory, company: row.companyName, unit: row.unit, lots: [] };
      itemCodeMap.set(row.code.toLowerCase(), item);
      itemNameMap.set(nameKey, item);
      newItems.push(item);
    } else {
      item.name = row.itemName || item.name;
      item.category = row.category || item.category;
      item.subcategory = row.subcategory || item.subcategory;
      item.company = row.companyName || item.company;
      item.unit = row.unit || item.unit;
    }
    touchedItems.set(item.id, item);

    const lotKey = row.lotNo!.trim().toLowerCase();
    let lot = lotMap.get(`${item.id}|${lotKey}`);
    if (!lot) {
      lot = {
        id: importId('lot-erp', `${item.id}|${lotKey}`),
        itemId: item.id,
        lotNo: row.lotNo!,
        expiryDate: row.expiryDate,
        attributes: {
          source: 'opening-stock-import',
          companyName: row.companyName,
          batch: row.batch,
          purchaseValue: row.purchaseValue,
          saleValue: row.saleValue,
          purchaseRate: row.quantity ? (row.purchaseValue ?? 0) / row.quantity : null,
          saleRate: row.quantity ? (row.saleValue ?? 0) / row.quantity : null,
        },
      };
      lotMap.set(`${item.id}|${lotKey}`, lot);
      newLots.push(lot);
    } else if (row.expiryDate) {
      lot.expiryDate = row.expiryDate;
    }
    return { row, item, lot, location };
  });

  const batchId = options?.batchId ?? importId('imp-opening', `${fileName}|${importedBy}|${Date.now()}`);
  if (databaseEnabled) {
    requireDatabase();
    await prisma.$transaction(async (tx) => {
      if (newLocations.length) {
        await tx.location.createMany({
          data: newLocations.map((location) => ({
            id: location.id,
            code: `ERP-${location.id.slice(-12).toUpperCase()}`,
            name: location.name,
            type: location.type,
            companyId,
          })),
          skipDuplicates: true,
        });
      }
      const itemMasters = [...touchedItems.values()];
      for (let offset = 0; offset < itemMasters.length; offset += 500) {
        const chunk = itemMasters.slice(offset, offset + 500);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO Item (id, code, name, category, subcategory, company, companyId, unit, createdAt, updatedAt)
          VALUES ${Prisma.join(chunk.map((item) => Prisma.sql`(
            ${item.id}, ${item.code}, ${item.name}, ${item.category ?? null}, ${item.subcategory ?? null},
            ${item.company ?? null}, ${companyId}, ${item.unit}, NOW(), NOW()
          )`))}
          ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category),
            subcategory = VALUES(subcategory), company = VALUES(company), unit = VALUES(unit), updatedAt = NOW()
        `);
      }
      if (newLots.length) {
        await tx.lot.createMany({
          data: newLots.map((lot) => ({
            id: lot.id,
            itemId: lot.itemId,
            lotNo: lot.lotNo,
            expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null,
            attributes: lot.attributes as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }
      const lotsWithExpiry = [...lotMap.values()].filter((lot) => lot.expiryDate);
      for (let offset = 0; offset < lotsWithExpiry.length; offset += 400) {
        const chunk = lotsWithExpiry.slice(offset, offset + 400);
        await tx.$executeRaw(Prisma.sql`
          UPDATE Lot SET expiryDate = CASE id
            ${Prisma.join(chunk.map((lot) => Prisma.sql`WHEN ${lot.id} THEN ${new Date(lot.expiryDate!)}`), ' ')}
          END, updatedAt = NOW()
          WHERE id IN (${Prisma.join(chunk.map((lot) => Prisma.sql`${lot.id}`))})
        `);
      }

      await tx.importBatch.upsert({
        where: { id: batchId },
        create: {
          id: batchId,
          type: 'OPENING_STOCK',
          fileName,
          sourceFormat: preview.format,
          importedById: importedBy,
          totalRows: preview.totalRows,
          validRows: preview.validRows.length,
          invalidRows: preview.errors.length,
          duplicateRows: preview.duplicateRows,
          metadata: { branches: preview.branches, mapping: preview.mapping, negativeQuantityRows: preview.negativeQuantityRows, fractionalQuantityRows: preview.fractionalQuantityRows },
          status: 'POSTED',
          fileHash: options?.fileHash,
          branchId: options?.branchId ?? null,
        },
        update: {
          status: 'POSTED',
          validRows: preview.validRows.length,
          invalidRows: preview.errors.length,
          duplicateRows: preview.duplicateRows,
          metadata: { branches: preview.branches, mapping: preview.mapping, negativeQuantityRows: preview.negativeQuantityRows, fractionalQuantityRows: preview.fractionalQuantityRows },
        },
      });

      for (let offset = 0; offset < prepared.length; offset += 500) {
        const chunk = prepared.slice(offset, offset + 500);
        await tx.openingStockSnapshot.createMany({
          data: chunk.map(({ row, item, lot, location }) => ({
            id: importId('opening', `${batchId}|${item.id}|${lot.id}|${location.id}`),
            importBatchId: batchId,
            itemId: item.id,
            lotId: lot.id,
            locationId: location.id,
            qty: row.quantity ?? 0,
            snapshotAt: new Date(preview.snapshotAt),
          })),
          skipDuplicates: true,
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO StockLedger (id, itemId, lotId, locationId, onHand, reserved, inTransit, version, lastUpdatedAt)
          VALUES ${Prisma.join(chunk.map(({ row, item, lot, location }) => Prisma.sql`(
            ${importId('stock', `${item.id}|${lot.id}|${location.id}`)}, ${item.id}, ${lot.id}, ${location.id},
            ${row.quantity ?? 0}, 0, 0, 1, NOW()
          )`))}
          ON DUPLICATE KEY UPDATE onHand = VALUES(onHand), version = version + 1, lastUpdatedAt = NOW()
        `);
      }
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  locations.push(...newLocations);
  items.push(...newItems);
  for (const location of newLocations) registerLocationCompany(location.id, companyId);
  for (const item of newItems) registerItemCompany(item.id, companyId);
  for (const lot of newLots) {
    const item = items.find((candidate) => candidate.id === lot.itemId);
    if (item && !item.lots.some((candidate) => candidate.id === lot.id)) item.lots.push(lot);
  }
  for (const { row, item, lot, location } of prepared) {
    const existing = stockLedger.find((entry) => entry.itemId === item.id && entry.lotId === lot.id && entry.locationId === location.id);
    if (existing) {
      existing.onHand = row.quantity ?? 0;
      existing.version += 1;
    } else {
      stockLedger.push({ itemId: item.id, lotId: lot.id, locationId: location.id, onHand: row.quantity ?? 0, quarantine: 0, version: 1 });
    }
  }

  return { batchId, importedItems: newItems.length, importedLots: newLots.length, importedLocations: newLocations.length, stockRows: prepared.length };
}

export async function persistDailyMovementImport(input: { batchId: string; importType: 'SALES' | 'PURCHASE' | 'ADJUSTMENT' | string; fileName: string; importedBy: string; totalRows: number; invalidRows: number; duplicateRows: number; transactionFrom?: string; transactionTo?: string; movements: DailyMovementRecord[]; lots: LotRecord[]; checkpoints: SyncCheckpointRecord[]; fileHash?: string; branchId?: string | null; sourceFormat?: string; metadata?: Record<string, unknown> }): Promise<{ committedRows: number }> {
  if (!databaseEnabled) return { committedRows: input.movements.length };
  requireDatabase();
  let committedRows = 0;
  await prisma.$transaction(async (tx) => {
    const metadata = { transactionFrom: input.transactionFrom, transactionTo: input.transactionTo, ...(input.metadata ?? {}) };
    await tx.importBatch.upsert({
      where: { id: input.batchId },
      create: {
        id: input.batchId,
        type: input.importType,
        fileName: input.fileName,
        sourceFormat: input.sourceFormat ?? 'daily-erp-export',
        importedById: input.importedBy,
        totalRows: input.totalRows,
        validRows: input.movements.length,
        invalidRows: input.invalidRows,
        duplicateRows: input.duplicateRows,
        metadata,
        status: 'POSTED',
        fileHash: input.fileHash,
        branchId: input.branchId ?? null,
        sourceDateFrom: input.transactionFrom ? new Date(input.transactionFrom) : null,
        sourceDateTo: input.transactionTo ? new Date(input.transactionTo) : null,
      },
      update: {
        status: 'POSTED',
        validRows: input.movements.length,
        invalidRows: input.invalidRows,
        duplicateRows: input.duplicateRows,
        metadata,
      },
    });
    for (const lot of input.lots) await tx.lot.upsert({ where: { itemId_lotNo: { itemId: lot.itemId, lotNo: lot.lotNo } }, update: { expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : undefined, attributes: lot.attributes as Prisma.InputJsonValue }, create: { id: lot.id, itemId: lot.itemId, lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes as Prisma.InputJsonValue } });
    // Import in bounded chunks so 5,000+ lot rows do not time out on shared
    // Hostinger MySQL. Existing dedupe keys are excluded before ledger updates,
    // preventing a retried file from changing stock twice.
    for (let offset = 0; offset < input.movements.length; offset += 400) {
      const chunk = input.movements.slice(offset, offset + 400);
      const existing = await tx.inventoryMovement.findMany({
        where: { dedupeKey: { in: chunk.map((movement) => movement.dedupeKey) } },
        select: { dedupeKey: true },
      });
      const existingKeys = new Set(existing.map((entry) => entry.dedupeKey));
      const fresh = chunk.filter((movement) => !existingKeys.has(movement.dedupeKey));
      if (!fresh.length) continue;
      await tx.inventoryMovement.createMany({
        data: fresh.map((movement) => ({ id: movement.id, dedupeKey: movement.dedupeKey, itemId: movement.itemId, lotId: movement.lotId, locationId: movement.locationId, movementType: movement.movementType, qtyDelta: movement.qtyDelta, transactionAt: new Date(movement.transactionAt), sourceType: movement.sourceType, sourceReference: movement.sourceReference, importBatchId: input.batchId, createdById: movement.createdById, metadata: movement.metadata as Prisma.InputJsonValue })),
        skipDuplicates: true,
      });
      committedRows += fresh.length;
      const ledgerRows = fresh.filter((movement) => movement.lotId);
      if (ledgerRows.length) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO StockLedger (id, itemId, lotId, locationId, onHand, reserved, inTransit, version, lastUpdatedAt)
          VALUES ${Prisma.join(ledgerRows.map((movement) => Prisma.sql`(
            ${importId('stock', `${movement.itemId}|${movement.lotId}|${movement.locationId}`)},
            ${movement.itemId}, ${movement.lotId!}, ${movement.locationId}, ${movement.qtyDelta}, 0, 0, 1, NOW()
          )`))}
          ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), version = version + 1, lastUpdatedAt = NOW()
        `);
      }
    }
    for (const checkpoint of input.checkpoints) await tx.syncCheckpoint.upsert({ where: { locationId_sourceType: { locationId: checkpoint.locationId, sourceType: checkpoint.sourceType } }, update: { syncedThroughAt: new Date(checkpoint.syncedThroughAt), lastImportBatchId: input.batchId }, create: { locationId: checkpoint.locationId, sourceType: checkpoint.sourceType, syncedThroughAt: new Date(checkpoint.syncedThroughAt), lastImportBatchId: input.batchId } });
  }, { maxWait: 10_000, timeout: 120_000 });
  return { committedRows };
}

export async function persistCount(count: CountRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.stockCount.upsert({
    where: { id: count.id },
    update: {
      physicalQty: count.physicalQuantity,
      bookQty: count.bookQty,
      mode: count.mode,
      parentCountId: count.parentCountId ?? null,
    },
    create: {
      id: count.id,
      itemId: count.itemId,
      lotId: count.lotId,
      locationId: count.locationId,
      physicalQty: count.physicalQuantity,
      bookQty: count.bookQty,
      mode: count.mode,
      submittedById: count.submittedBy,
      parentCountId: count.parentCountId ?? null,
    },
  });
}

export async function listStockFromDatabase(locationId: string): Promise<PersistedStockRow[]> {
  requireDatabase();
  const rows = await prisma.stockLedger.findMany({ where: { locationId } });
  return rows.map((row) => ({
    itemId: row.itemId,
    lotId: row.lotId,
    locationId: row.locationId,
    bookQuantity: row.onHand,
    physicalQuantity: row.onHand,
    variance: 0,
    stockValue: 0,
    quarantineQuantity: row.quarantine,
    damagedQuantity: row.damaged,
    reservedQuantity: row.reserved,
    // Blueprint §7.2: "Available = On Hand - Reserved."
    availableQuantity: Math.max(0, row.onHand - row.reserved),
  }));
}

/**
 * Persists a count review decision. On APPROVED this also posts the
 * resulting variance to the stock ledger, in the same transaction, so the
 * count status and the on-hand quantity can never disagree.
 */
export async function persistCountReview(count: CountRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.stockCount.updateMany({
      where: { id: count.id, reviewStatus: 'PENDING_REVIEW' },
      data: {
        approvedById: count.status === 'APPROVED' ? count.reviewedBy : null,
        approvedAt: (count.status === 'APPROVED' || count.status === 'REJECTED' || count.status === 'RECOUNT') && count.reviewedAt
          ? new Date(count.reviewedAt)
          : null,
        reviewStatus: count.status ?? 'PENDING_REVIEW',
        reviewReason: count.reviewReason ?? null,
      },
    });
    if (claimed.count !== 1) throw new Error('Stock count was already reviewed; variance was not posted again.');

    if (count.status === 'APPROVED') {
      const variance = count.physicalQuantity - count.bookQty;
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: count.itemId, lotId: count.lotId, locationId: count.locationId } },
      });
      const beforeBalance = ledger?.onHand ?? count.bookQty;
      const afterBalance = beforeBalance + variance;
      await tx.stockLedger.upsert({
        where: { itemId_lotId_locationId: { itemId: count.itemId, lotId: count.lotId, locationId: count.locationId } },
        update: { onHand: { increment: variance }, version: { increment: 1 } },
        create: { itemId: count.itemId, lotId: count.lotId, locationId: count.locationId, onHand: Math.max(0, afterBalance), version: 1 },
      });
      await tx.stockMovement.create({
        data: {
          itemId: count.itemId,
          lotId: count.lotId,
          locationId: count.locationId,
          movementType: 'COUNT_VARIANCE',
          qtyDelta: variance,
          beforeBalance,
          afterBalance,
          sourceDocument: count.id,
          sourceLineId: count.id,
          actor: count.reviewedBy,
          timestamp: count.reviewedAt ? new Date(count.reviewedAt) : new Date(),
          correlationId: count.id,
          reason: count.reviewReason,
          metadata: { countId: count.id, physicalQuantity: count.physicalQuantity, bookQty: count.bookQty },
        },
      });
    }
  });
}

export async function persistCountAssignment(assignment: CountAssignmentRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.create({
    data: {
      id: assignment.id,
      locationId: assignment.locationId,
      itemId: assignment.itemId,
      assignedToId: assignment.assignedToId,
      assignedById: assignment.assignedById,
      countDate: new Date(assignment.countDate),
      dueDate: assignment.dueDate ? new Date(assignment.dueDate) : null,
      priority: assignment.priority ?? 'NORMAL',
      instructions: assignment.instructions,
      status: assignment.status,
      parentCountId: assignment.parentCountId ?? null,
    },
  });
}

export async function persistCountAssignmentUpdate(assignment: CountAssignmentRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.update({
    where: { id: assignment.id },
    data: {
      assignedToId: assignment.assignedToId,
      countDate: new Date(assignment.countDate),
      dueDate: assignment.dueDate ? new Date(assignment.dueDate) : null,
      priority: assignment.priority ?? 'NORMAL',
      instructions: assignment.instructions ?? null,
      status: assignment.status,
      countId: assignment.countId ?? null,
      parentCountId: assignment.parentCountId ?? null,
    },
  });
}

export async function persistAssignmentSubmitted(assignmentId: string, countId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.update({ where: { id: assignmentId }, data: { status: 'SUBMITTED', countId } });
}

export async function persistTransfer(transfer: TransferRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const status = transfer.status === 'SUBMITTED' ? 'REQUESTED' : transfer.status === 'PARTIALLY_RECEIVED' ? 'PARTIAL_RECEIVED' : transfer.status;
  await prisma.transfer.upsert({
    where: { id: transfer.id },
    update: { status: status as any, notes: transfer.notes, cartonCount: transfer.cartonCount ?? null },
    create: {
      id: transfer.id,
      sourceLocationId: transfer.sourceLocationId,
      destinationLocationId: transfer.destinationLocationId,
      requestedById: transfer.requestedBy,
      status: status as any,
      notes: transfer.notes,
      cartonCount: transfer.cartonCount ?? null,
      lines: { create: transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity })) },
    },
  });
}

export async function persistTransferStatus(transfer: TransferRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const status = transfer.status === 'SUBMITTED' ? 'REQUESTED' : transfer.status === 'PARTIALLY_RECEIVED' ? 'PARTIAL_RECEIVED' : transfer.status;
  await prisma.transfer.update({ where: { id: transfer.id }, data: { status: status as any } });
}

export async function persistConfirmedPickAllocations(
  transferId: string,
  allocations: Array<{ itemId: string; lotId: string; locationId: string; quantity: number }>,
): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new Error('Transfer was not found.');
    if (['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED', 'CLOSED'].includes(String(transfer.status))) {
      throw new Error('Transfer is already confirmed and stock cannot be deducted twice.');
    }
    for (const allocation of allocations) {
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId } },
      });
      if (!ledger || ledger.onHand < allocation.quantity) throw new Error(`Insufficient current stock for lot ${allocation.lotId}.`);
      await tx.stockLedger.update({
        where: { itemId_lotId_locationId: { itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId } },
        data: { onHand: { decrement: allocation.quantity }, version: { increment: 1 } },
      });
    }
    await tx.transfer.update({ where: { id: transferId }, data: { status: 'CONFIRMED' as any } });
  }, { maxWait: 10_000, timeout: 60_000 });
}

// Company self-registration writes the new admin into enhancedUsers (see
// enterprise-repository.ts) so it can log in immediately, but that array is
// in-memory only and startup's hydrateDatabase() (index.ts) overwrites it
// wholesale from the User table on every restart. Without this, a user
// created after boot is silently gone on the next one - not because the
// process restarted, but because hydration replaces the very array their
// row lived in with what the database has, which never received it either.
export async function persistEnterpriseUser(user: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  locationIds: string[];
  companyId?: string;
}): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.create({
    data: {
      id: user.id,
      name: user.name,
      email: user.email.toLowerCase(),
      passwordHash: user.passwordHash,
      role: user.role,
      assignedLocations: JSON.stringify(user.locationIds ?? []),
      companyId: user.companyId ?? DEFAULT_COMPANY_ID,
    },
  });
}

export async function hydrateAuthUsers(): Promise<number> {
  if (!databaseEnabled) return enhancedUsers.length;
  requireDatabase();
  const { ensureDailySyncSchema } = await import('./runtime-schema.js');
  await prisma.$queryRaw`SELECT 1`;
  await ensureDailySyncSchema();
  const dbUsers = await prisma.user.findMany();
  enhancedUsers.length = 0;
  for (const user of dbUsers) {
    enhancedUsers.push({
      id: user.id,
      companyId: (user as { companyId?: string }).companyId || DEFAULT_COMPANY_ID,
      name: user.name,
      email: user.email,
      role: user.role,
      passwordHash: user.passwordHash,
      branchIds: [],
      locationIds: parseAssignedLocations(user.assignedLocations),
      status: 'active',
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    });
  }
  return enhancedUsers.length;
}

export async function hydrateCompanyProfile(): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const row = await prisma.companyProfile.findUnique({ where: { id: 'default' } });
  if (row) {
    setCompanyProfile({
      name: row.name,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      industry: row.industry ?? undefined,
      industryKey: (row as { industryKey?: string | null }).industryKey ?? undefined,
      address: row.address ?? undefined,
    });
    await hydrateActiveWorkflow((row as { industryKey?: string | null }).industryKey ?? row.industry);
  }
}

export async function persistCompanyProfile(profile: CompanyProfileRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.companyProfile.upsert({
    where: { id: 'default' },
    update: { name: profile.name, email: profile.email, phone: profile.phone, industry: profile.industry, industryKey: profile.industryKey, address: profile.address },
    create: { id: 'default', name: profile.name, email: profile.email, phone: profile.phone, industry: profile.industry, industryKey: profile.industryKey, address: profile.address },
  });
}

export async function persistLocationCreate(location: LocationRecord, code: string, companyId = DEFAULT_COMPANY_ID): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.location.create({ data: { id: location.id, code, name: location.name, type: location.type, companyId, tenantId: DEFAULT_TENANT_ID } });
}

export async function persistLocationUpdate(location: LocationRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.location.update({ where: { id: location.id }, data: { name: location.name, type: location.type } });
}

export async function persistLocationDelete(locationId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.location.delete({ where: { id: locationId } });
}

export async function persistUserCreate(user: UserRecord, passwordHash: string, companyId = DEFAULT_COMPANY_ID): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.create({
    data: {
      id: user.id,
      name: user.name,
      email: user.email.toLowerCase(),
      passwordHash,
      role: user.role,
      assignedLocations: JSON.stringify(user.assignedLocationIds ?? []),
      companyId,
      tenantId: DEFAULT_TENANT_ID,
    },
  });
}

export async function persistUserUpdate(user: UserRecord, passwordHash?: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: user.name,
      role: user.role,
      assignedLocations: JSON.stringify(user.assignedLocationIds ?? []),
      ...(passwordHash ? { passwordHash } : {}),
    },
  });
}

export async function persistUserDelete(userId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.user.delete({ where: { id: userId } });
}

export async function persistAudit(event: AuditEvent): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.auditLog.upsert({
    where: { id: event.id },
    update: { action: event.action, metadata: event.metadata as Prisma.InputJsonValue },
    create: {
      id: event.id,
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata as Prisma.InputJsonValue,
      createdAt: new Date(event.createdAt),
    },
  });
}
