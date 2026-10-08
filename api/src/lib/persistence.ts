import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma, resolveDatabaseUrl } from './db.js';
import type { CompanyProfileRecord, CountAssignmentRecord, CountRecord, ItemRecord, LocationRecord, TransferRecord, UserRecord } from './repository.js';
import type { AuditEvent } from './audit.js';
import { transferCartons, companyProfile, counts, countAssignments, dailyMovements, items, locations, saveCompanyProfile, setCompanyProfile, stockLedger, syncCheckpoints, transfers, users } from './repository.js';
import { enhancedUsers } from './enterprise-repository.js';
import type { Role } from './inventory.js';
import { aggregateOpeningStock, type StockImportPreview } from './stock-import.js';
import type { DailyMovementRecord, LotRecord, SyncCheckpointRecord } from './repository.js';
import { hydrateActiveWorkflow } from './industry-packs.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID, adoptHydratedOwnership, registerItemCompany, registerLocationCompany } from './saas/tenant-scope.js';
import { assertValidCountReviewTransition, transitionTransferStatus, type CountReviewStatus } from './domain-policies.js';
import { DomainError } from './errors.js';
import { postInventoryMovementInTransaction } from './inventory-posting-service.js';
import { journalTypeForImport, syncJournalToBalances } from './import-journal-sync.js';
import { replaceContents, pushAll } from './array-utils.js';

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
    throw new Error('Database persistence is disabled. Set DATABASE_URL to the Postgres database.');
  }
}

// Packing/dispatch details live in one JSON column; JSON null means "not set yet".
function logisticsOf(transfer: unknown): Pick<TransferRecord, 'packing' | 'dispatch'> {
  const raw = (transfer as { logistics?: { packing?: TransferRecord['packing'] | null; dispatch?: TransferRecord['dispatch'] | null } | null }).logistics;
  return { ...(raw?.packing ? { packing: raw.packing } : {}), ...(raw?.dispatch ? { dispatch: raw.dispatch } : {}) };
}

export async function hydrateRepositoryFromDatabase(): Promise<void> {
  if (!databaseEnabled) return;

  // `CompanyProfile` predates multi-tenant operational data and production's
  // singleton row is still keyed as `default`, while Location/User/Item rows
  // use `default-company`.  Treating profile ids as the complete tenant list
  // therefore emptied every operational in-memory mirror after a restart.
  // Keep profile-backed tenants, but always hydrate the canonical legacy/default
  // operational tenant as well.
  const profileCompanyIds = (await prisma.companyProfile.findMany({ select: { id: true } })).map((company) => company.id);
  const companyIds = [...new Set([DEFAULT_COMPANY_ID, ...profileCompanyIds])];

  const [dbLocations, dbItems, dbCounts, dbTransfers, dbStockLedger, dbAssignments, dbUsers] = await Promise.all([
    prisma.location.findMany({ where: { companyId: { in: companyIds } } }),
    prisma.item.findMany({ where: { companyId: { in: companyIds } }, include: { lots: true } }),
    prisma.stockCount.findMany({ where: { companyId: { in: companyIds } } }),
    prisma.transfer.findMany({ where: { companyId: { in: companyIds } }, include: { lines: true } }),
    prisma.stockLedger.findMany({ where: { companyId: { in: companyIds } } }),
    prisma.countAssignment.findMany({ where: { location: { companyId: { in: companyIds } } } }),
    prisma.user.findMany({ where: { companyId: { in: companyIds } } }),
  ]);

  replaceContents(locations, dbLocations.map((location) => ({
    id: location.id,
    name: location.name,
    type: location.type as 'store' | 'warehouse',
  })));

  replaceContents(items, dbItems.map((item: any) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category ?? undefined,
    subcategory: item.subcategory ?? undefined,
    company: item.company ?? undefined,
    unit: item.unit ?? undefined,
    countMethod: item.countMethod ?? 'LOT_SCAN',
    pickMethod: item.pickMethod ?? 'LOT_SCAN',
    allocationStrategy: item.allocationStrategy ?? 'FEFO',
    lotRequired: item.lotRequired ?? true,
    expiryRequired: item.expiryRequired ?? false,
    decimalQuantity: item.decimalQuantity ?? false,
    status: (item.status ?? 'ACTIVE') as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
    archiveReason: item.archiveReason ?? undefined,
    archivedAt: item.archivedAt?.toISOString(),
    archivedById: item.archivedById ?? undefined,
    barcode: item.barcode ?? undefined,
    hsn: item.hsn ?? undefined,
    gstRate: item.gstRate ?? undefined,
    mrp: item.mrp == null ? undefined : Number(item.mrp),
    leadTimeDays: item.leadTimeDays ?? undefined,
    shelfLifeDays: item.shelfLifeDays ?? undefined,
    aliases: Array.isArray(item.aliases) ? (item.aliases as string[]) : undefined,
    version: item.version ?? 1,
    createdById: item.createdById ?? undefined,
    updatedById: item.updatedById ?? undefined,
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

  replaceContents(counts, dbCounts.map((count) => ({
    id: count.id,
    itemId: count.itemId,
    lotId: count.lotId,
    locationId: count.locationId,
    physicalQuantity: count.physicalQty,
    bookQty: count.bookQty,
    mode: count.mode as 'scan' | 'manual' | 'weight',
    submittedBy: count.submittedById,
    role: 'STORE_USER' as const,
    createdAt: count.createdAt.toISOString(),
    status: count.reviewStatus as 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW' | 'RECOUNT',
    reviewedBy: count.approvedById ?? undefined,
    reviewedAt: count.approvedAt?.toISOString(),
    reviewReason: count.reviewReason ?? undefined,
    reasonCode: (count as { reasonCode?: string | null }).reasonCode ?? undefined,
    parentCountId: count.parentCountId ?? undefined,
    requestId: (count as { requestId?: string | null }).requestId ?? undefined,
    reconciliationRequired: (count as { reconciliationRequired?: boolean }).reconciliationRequired ?? false,
    reconciliationNote: (count as { reconciliationNote?: string | null }).reconciliationNote ?? undefined,
    reconciliationAt: (count as { reconciliationAt?: Date | null }).reconciliationAt?.toISOString(),
    bookQtyOriginal: (count as { bookQtyOriginal?: number | null }).bookQtyOriginal ?? undefined,
    lateDelta: (count as { lateDelta?: number }).lateDelta ?? 0,
    lateMovementKeys: Array.isArray((count as { lateMovementKeys?: unknown }).lateMovementKeys) ? (count as { lateMovementKeys: string[] }).lateMovementKeys : undefined,
  })));

  replaceContents(stockLedger, dbStockLedger.map((row) => ({
    itemId: row.itemId,
    lotId: row.lotId,
    locationId: row.locationId,
    onHand: row.onHand,
    quarantine: row.quarantine,
    version: row.version,
  })));

  replaceContents(users, dbUsers.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    assignedLocationIds: parseAssignedLocations(user.assignedLocations),
  })));

  replaceContents(countAssignments, dbAssignments.map((row) => ({
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
    campaignId: (row as { campaignId?: string | null }).campaignId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  })));

  replaceContents(transfers, dbTransfers.map((transfer) => ({
    id: transfer.id,
    sourceLocationId: transfer.sourceLocationId,
    destinationLocationId: transfer.destinationLocationId,
    requestedBy: transfer.requestedById,
    role: 'ADMIN' as const,
    status: transfer.status,
    cartonCount: transfer.cartonCount ?? undefined,
    notes: transfer.notes ?? undefined,
    lines: transfer.lines.map((line: any) => ({ itemId: line.itemId, lotId: line.lotId, quantity: line.requestedQty, receivedQty: line.receivedQty, damagedQty: line.damagedQty, shortageQty: line.shortageQty ?? 0 })),
    ...logisticsOf(transfer),
    createdAt: transfer.createdAt.toISOString(),
  })));

  try {
    const dbCartons = await prisma.transferCarton.findMany({ orderBy: { createdAt: 'asc' } });
    replaceContents(transferCartons, dbCartons.map((row) => {
      const contents = (row.contents ?? {}) as { lines?: Array<{ itemId: string; lotId: string; quantity: number }>; packedById?: string; sealedAt?: string; requestId?: string };
      return {
        id: row.id,
        transferId: row.transferId,
        cartonNumber: row.cartonNumber,
        packageId: row.qrCode ?? row.cartonNumber,
        lines: contents.lines ?? [],
        quantity: row.quantity,
        weightKg: row.weight ?? undefined,
        status: (row.status === 'VOID' ? 'VOID' : 'SEALED') as 'SEALED' | 'VOID',
        packedById: contents.packedById ?? '',
        sealedAt: contents.sealedAt ?? row.createdAt.toISOString(),
        requestId: contents.requestId,
      };
    }));
  } catch (error) {
    console.warn('Transfer cartons could not be hydrated:', error instanceof Error ? error.message : error);
  }

  // These tables were introduced after the original Hostinger deployment.
  // Keep startup compatible while the migration is pending, then hydrate them
  // normally once present so sync state survives an API restart.
  try {
    const [dbMovements, dbCheckpoints] = await Promise.all([
      prisma.inventoryMovement.findMany({ orderBy: { transactionAt: 'desc' }, take: 10_000 }),
      prisma.syncCheckpoint.findMany(),
    ]);
    replaceContents(dailyMovements, dbMovements.map((row) => ({
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
    replaceContents(syncCheckpoints, dbCheckpoints
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
  const operationalFields = {
    countMethod: item.countMethod,
    pickMethod: item.pickMethod,
    allocationStrategy: item.allocationStrategy,
    lotRequired: item.lotRequired,
    expiryRequired: item.expiryRequired,
    decimalQuantity: item.decimalQuantity,
  };
  // The full item state is written every time, so a cleared optional field
  // must become NULL (an undefined key would leave the old value in place).
  const masterFields = {
    status: item.status ?? 'ACTIVE',
    archiveReason: item.archiveReason ?? null,
    archivedAt: item.archivedAt ? new Date(item.archivedAt) : null,
    archivedById: item.archivedById ?? null,
    barcode: item.barcode ?? null,
    hsn: item.hsn ?? null,
    gstRate: item.gstRate ?? null,
    mrp: item.mrp ?? null,
    leadTimeDays: item.leadTimeDays ?? null,
    shelfLifeDays: item.shelfLifeDays ?? null,
    aliases: (item.aliases?.length ? item.aliases : Prisma.JsonNull) as Prisma.InputJsonValue,
    version: item.version ?? 1,
    createdById: item.createdById ?? null,
    updatedById: item.updatedById ?? null,
  };
  await prisma.item.upsert({
    where: { id: item.id },
    update: { code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, unit: item.unit, ...operationalFields, ...masterFields } as any,
    create: { id: item.id, code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, companyId, tenantId: DEFAULT_TENANT_ID, unit: item.unit, ...operationalFields, ...masterFields } as any,
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
          INSERT INTO "Item" (id, code, name, category, subcategory, company, "companyId", unit, "createdAt", "updatedAt")
          VALUES ${Prisma.join(chunk.map((item) => Prisma.sql`(
            ${item.id}, ${item.code}, ${item.name}, ${item.category ?? null}, ${item.subcategory ?? null},
            ${item.company ?? null}, ${companyId}, ${item.unit}, NOW(), NOW()
          )`))}
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
            subcategory = EXCLUDED.subcategory, company = EXCLUDED.company, unit = EXCLUDED.unit, "updatedAt" = NOW()
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
          UPDATE "Lot" SET "expiryDate" = CASE id
            ${Prisma.join(chunk.map((lot) => Prisma.sql`WHEN ${lot.id} THEN ${new Date(lot.expiryDate!)}::timestamp`), ' ')}
          END, "updatedAt" = NOW()
          WHERE id IN (${Prisma.join(chunk.map((lot) => Prisma.sql`${lot.id}`))})
        `);
      }

      await tx.importBatch.upsert({
        where: { id: batchId },
        create: {
          id: batchId,
          type: 'OPENING_STOCK',
          companyId,
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
          INSERT INTO "StockLedger" (id, "itemId", "lotId", "locationId", "onHand", reserved, "inTransit", version, "lastUpdatedAt", "companyId")
          VALUES ${Prisma.join(chunk.map(({ row, item, lot, location }) => Prisma.sql`(
            ${importId('stock', `${item.id}|${lot.id}|${location.id}`)}, ${item.id}, ${lot.id}, ${location.id},
            ${row.quantity ?? 0}, 0, 0, 1, NOW(), ${companyId}
          )`))}
          ON CONFLICT ("itemId","lotId","locationId") DO UPDATE SET "onHand" = EXCLUDED."onHand", version = "StockLedger".version + 1, "lastUpdatedAt" = NOW()
        `);
        // The movement journal must explain this balance too (lib/import-journal-sync.ts).
        await syncJournalToBalances(tx, chunk.map(({ item, lot, location }) => ({ itemId: item.id, lotId: lot.id, locationId: location.id })), {
          companyId, batchId, actor: importedBy, movementType: 'OPENING_STOCK',
          reason: 'Opening stock import: balance set by file',
        });
      }
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  pushAll(locations, newLocations);
  pushAll(items, newItems);
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

export async function persistDailyMovementImport(input: { batchId: string; importType: 'SALES' | 'PURCHASE' | 'ADJUSTMENT' | string; fileName: string; importedBy: string; totalRows: number; invalidRows: number; duplicateRows: number; transactionFrom?: string; transactionTo?: string; movements: DailyMovementRecord[]; lots: LotRecord[]; checkpoints: SyncCheckpointRecord[]; fileHash?: string; branchId?: string | null; sourceFormat?: string; metadata?: Record<string, unknown>; companyId?: string }): Promise<{ committedRows: number }> {
  if (!databaseEnabled) return { committedRows: input.movements.length };
  const companyId = input.companyId || 'default-company';
  requireDatabase();
  let committedRows = 0;
  await prisma.$transaction(async (tx) => {
    const metadata = { transactionFrom: input.transactionFrom, transactionTo: input.transactionTo, ...(input.metadata ?? {}) };
    await tx.importBatch.upsert({
      where: { id: input.batchId },
      create: {
        id: input.batchId,
        type: input.importType,
        companyId,
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
    // Import in bounded chunks so 5,000+ lot rows do not time out the
    // database connection. Existing dedupe keys are excluded before ledger updates,
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
          INSERT INTO "StockLedger" (id, "itemId", "lotId", "locationId", "onHand", reserved, "inTransit", version, "lastUpdatedAt", "companyId")
          VALUES ${Prisma.join(ledgerRows.map((movement) => Prisma.sql`(
            ${importId('stock', `${movement.itemId}|${movement.lotId}|${movement.locationId}`)},
            ${movement.itemId}, ${movement.lotId!}, ${movement.locationId}, ${movement.qtyDelta}, 0, 0, 1, NOW(), ${companyId}
          )`))}
          ON CONFLICT ("itemId","lotId","locationId") DO UPDATE SET "onHand" = "StockLedger"."onHand" + EXCLUDED."onHand", version = "StockLedger".version + 1, "lastUpdatedAt" = NOW()
        `);
        // Journal the net effect of this chunk (lib/import-journal-sync.ts); a re-sent file adds nothing.
        await syncJournalToBalances(tx, ledgerRows.map((movement) => ({ itemId: movement.itemId, lotId: movement.lotId!, locationId: movement.locationId })), {
          companyId, batchId: input.batchId, actor: input.importedBy, movementType: journalTypeForImport(String(input.importType)),
          reason: `${input.importType} import ${input.fileName}`,
        });
      }
    }
    for (const checkpoint of input.checkpoints) {
      const key = { locationId_sourceType: { locationId: checkpoint.locationId, sourceType: checkpoint.sourceType } };
      const next = new Date(checkpoint.syncedThroughAt);
      const existing = await tx.syncCheckpoint.findUnique({ where: key });
      // Only ever move forward: a backfill of an older day must not regress the branch.
      if (existing && existing.syncedThroughAt >= next) continue;
      await tx.syncCheckpoint.upsert({ where: key, update: { syncedThroughAt: next, lastImportBatchId: input.batchId }, create: { locationId: checkpoint.locationId, sourceType: checkpoint.sourceType, syncedThroughAt: next, lastImportBatchId: input.batchId } });
    }
  }, { maxWait: 10_000, timeout: 120_000 });
  return { committedRows };
}

/** Best-effort removal of a count whose sibling lots failed to save (weight counts are all-or-nothing). */
export async function persistCountDeletion(id: string, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.stockCount.delete({ where: { id, companyId } }).catch(() => undefined);
}

export async function persistCount(count: CountRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.stockCount.upsert({
    where: { id: count.id, companyId },
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
      requestId: count.requestId ?? null,
      companyId,
    } as never,
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
/** Writes the reconciliation state (and a recomputed book quantity) of a count. */
export async function persistCountReconciliation(count: CountRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.stockCount.update({
    where: { id: count.id, companyId },
    data: {
      bookQty: count.bookQty,
      reconciliationRequired: count.reconciliationRequired ?? false,
      reconciliationNote: count.reconciliationNote ?? null,
      reconciliationAt: count.reconciliationAt ? new Date(count.reconciliationAt) : null,
      bookQtyOriginal: count.bookQtyOriginal ?? null,
      lateDelta: count.lateDelta ?? 0,
      lateMovementKeys: (count.lateMovementKeys ?? []) as unknown as Prisma.InputJsonValue,
    } as never,
  });
}

export async function persistCountReview(count: CountRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();

  // Week 7: name the legal moves centrally instead of relying only on the
  // `WHERE reviewStatus = 'PENDING_REVIEW'` claim below to reject a bad
  // target status. The claim still does the concurrency-safe part (two
  // simultaneous reviews of the same count can't both win); this rejects an
  // illegal *target* (e.g. something other than APPROVED/REJECTED/RECOUNT)
  // before the transaction opens, with a stable error code and an audit row.
  await assertValidCountReviewTransition(
    'PENDING_REVIEW',
    (count.status ?? 'PENDING_REVIEW') as CountReviewStatus,
    count.id,
    { actorId: count.reviewedBy ?? 'system', actorRole: count.role ?? 'UNKNOWN', reason: count.reviewReason },
  );

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.stockCount.updateMany({
      where: { id: count.id, companyId, reviewStatus: 'PENDING_REVIEW' },
      data: {
        approvedById: count.status === 'APPROVED' ? count.reviewedBy : null,
        approvedAt: (count.status === 'APPROVED' || count.status === 'REJECTED' || count.status === 'RECOUNT') && count.reviewedAt
          ? new Date(count.reviewedAt)
          : null,
        reviewStatus: count.status ?? 'PENDING_REVIEW',
        reviewReason: count.reviewReason ?? null,
        reasonCode: count.reasonCode ?? null,
      },
    });
    if (claimed.count !== 1) {
      throw new DomainError('CONCURRENT_UPDATE_CONFLICT', 'Stock count was already reviewed; variance was not posted again.');
    }

    if (count.status === 'APPROVED') {
      const variance = count.physicalQuantity - count.bookQty;
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: count.itemId, lotId: count.lotId, locationId: count.locationId } },
      });
      // Posted through the canonical service in this same transaction (journal + ledger +
      // audit + outbox with the review). A count with no ledger row yet establishes stock
      // at the physical quantity. The review claim above already guarantees one posting;
      // the idempotency key is the second, independent guard.
      await postInventoryMovementInTransaction(tx, {
        tenant: {
          companyId, tenantId: DEFAULT_TENANT_ID,
          userId: count.reviewedBy ?? 'system', role: (count.role ?? 'ADMIN') as Role,
        },
        itemId: count.itemId, lotId: count.lotId, locationId: count.locationId,
        movementType: 'COUNT_VARIANCE', qtyDelta: ledger ? variance : count.physicalQuantity,
        idempotencyKey: `count-variance:${count.id}`,
        reason: count.reviewReason ?? 'Approved stock count variance', sourceDocument: count.id, sourceLineId: count.id, correlationId: count.id,
        metadata: { countId: count.id, physicalQuantity: count.physicalQuantity, bookQty: count.bookQty },
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
      campaignId: assignment.campaignId ?? null,
    } as any,
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

export async function persistCountAssignmentDelete(assignmentId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.delete({ where: { id: assignmentId } });
}

export async function persistAssignmentSubmitted(assignmentId: string, countId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.countAssignment.update({ where: { id: assignmentId }, data: { status: 'SUBMITTED', countId } });
}

export async function persistTransfer(transfer: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const status = transfer.status === 'SUBMITTED' ? 'REQUESTED' : transfer.status === 'PARTIALLY_RECEIVED' ? 'PARTIAL_RECEIVED' : transfer.status;
  await prisma.transfer.upsert({
    where: { id: transfer.id, companyId },
    update: { status: status as any, notes: transfer.notes, cartonCount: transfer.cartonCount ?? null },
    create: {
      id: transfer.id,
      sourceLocationId: transfer.sourceLocationId,
      destinationLocationId: transfer.destinationLocationId,
      requestedById: transfer.requestedBy,
      status: status as any,
      notes: transfer.notes,
      cartonCount: transfer.cartonCount ?? null,
      companyId,
      lines: { create: transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity })) },
    },
  });
}

function transferReservationTotals(transfer: TransferRecord): Map<string, { itemId: string; lotId: string; locationId: string; quantity: number }> {
  const totals = new Map<string, { itemId: string; lotId: string; locationId: string; quantity: number }>();
  for (const line of transfer.lines) {
    const key = `${line.itemId}\u0000${line.lotId}\u0000${transfer.sourceLocationId}`;
    const current = totals.get(key);
    if (current) current.quantity += line.quantity;
    else totals.set(key, { itemId: line.itemId, lotId: line.lotId, locationId: transfer.sourceLocationId, quantity: line.quantity });
  }
  return totals;
}

export async function persistTransferReplacement(current: TransferRecord, next: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.$transaction(async (tx) => {
    for (const line of transferReservationTotals(current).values()) {
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: line.lotId, locationId: line.locationId } },
      });
      if (ledger) {
        await tx.stockLedger.update({ where: { id: ledger.id }, data: { reserved: Math.max(0, ledger.reserved - line.quantity), version: { increment: 1 } } });
      }
    }
    for (const line of transferReservationTotals(next).values()) {
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: line.lotId, locationId: line.locationId } },
      });
      const available = (ledger?.onHand ?? 0) - (ledger?.reserved ?? 0);
      if (!ledger || available < line.quantity - 1e-8) {
        throw new Error(`Only ${Math.max(0, available)} units are available for lot ${line.lotId} at this location - ${line.quantity} were requested.`);
      }
      await tx.stockLedger.update({ where: { id: ledger.id }, data: { reserved: { increment: line.quantity }, version: { increment: 1 } } });
    }
    await tx.transferLine.deleteMany({ where: { transferId: current.id } });
    await tx.transfer.update({
      where: { id: current.id, companyId },
      data: {
        sourceLocationId: next.sourceLocationId,
        destinationLocationId: next.destinationLocationId,
        notes: next.notes ?? null,
        cartonCount: next.cartonCount ?? null,
        lines: { create: next.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity })) },
      },
    });
  });
}

export async function persistTransferDeletion(transfer: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.$transaction(async (tx) => {
    for (const line of transferReservationTotals(transfer).values()) {
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: line.lotId, locationId: line.locationId } },
      });
      if (ledger) {
        await tx.stockLedger.update({ where: { id: ledger.id }, data: { reserved: Math.max(0, ledger.reserved - line.quantity), version: { increment: 1 } } });
      }
    }
    await tx.transferLine.deleteMany({ where: { transferId: transfer.id } });
    await tx.transfer.delete({ where: { id: transfer.id, companyId } });
  });
}

export async function persistTransferCarton(carton: import('./transfer-packing.js').TransferCartonRecord): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const contents = { lines: carton.lines, packedById: carton.packedById, sealedAt: carton.sealedAt, requestId: carton.requestId ?? null };
  await prisma.transferCarton.upsert({
    where: { id: carton.id },
    update: { status: carton.status, contents: contents as never },
    create: {
      id: carton.id, transferId: carton.transferId, cartonNumber: carton.cartonNumber, qrCode: carton.packageId,
      contents: contents as never, quantity: carton.quantity, weight: carton.weightKg ?? null, status: carton.status,
    },
  });
}

/** Packing completion / dispatch details / carton count for a transfer. */
export async function persistTransferLogistics(transfer: TransferRecord, companyId: string): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.transfer.update({
    where: { id: transfer.id, companyId },
    data: { cartonCount: transfer.cartonCount ?? null, logistics: { packing: transfer.packing ?? null, dispatch: transfer.dispatch ?? null } as never },
  });
}

export async function persistTransferStatus(
  transfer: TransferRecord,
  actor: { id: string; role: Role; companyId: string },
): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await transitionTransferStatus({
    entityId: transfer.id,
    companyId: actor.companyId,
    to: transfer.status,
    role: actor.role,
    actorId: actor.id,
  });
}

export async function persistConfirmedPickAllocations(
  transferId: string,
  allocations: Array<{ itemId: string; lotId: string; locationId: string; quantity: number }>,
  tenant: import('./tenant-context.js').TenantContext,
): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  await prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findFirst({ where: { id: transferId, companyId: tenant.companyId } });
    if (!transfer) throw new Error('Transfer was not found.');
    if (['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED', 'CLOSED'].includes(String(transfer.status))) {
      throw new Error('Transfer is already confirmed and stock cannot be deducted twice.');
    }
    for (const allocation of allocations) {
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId } },
      });
      if (!ledger || ledger.onHand < allocation.quantity) throw new Error(`Insufficient current stock for lot ${allocation.lotId}.`);
      // Stock leaves the source through the canonical service, in this transaction.
      const outPost = await postInventoryMovementInTransaction(tx, {
        tenant,
        itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId,
        movementType: 'TRANSFER_OUT', qtyDelta: -allocation.quantity,
        idempotencyKey: `transfer-confirm:${transferId}:${allocation.itemId}:${allocation.lotId}:${allocation.locationId}`,
        reason: 'Transfer pick confirmed', sourceDocument: transferId, correlationId: transferId,
        // Marks the leg as tracked in transit, so the receipt only releases what this confirm added.
        metadata: { inTransit: true },
      });
      // Stock in flight stays visible on the source lot row until the receipt releases it (audit O-7).
      // Skipped when this confirm was already applied (duplicate idempotent post), so a replay cannot double it.
      if (!outPost.duplicate) {
        await tx.stockLedger.updateMany({
          where: { itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId },
          data: { inTransit: { increment: allocation.quantity } },
        });
      }
    }
    await tx.transfer.update({ where: { id: transferId, companyId: tenant.companyId }, data: { status: 'CONFIRMED' as any } });
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
  // Every other company's own profile row (id = company id). 'default-company' is the default company, whose
  // profile is the 'default' row above, so a row with that id is not read as a separate profile.
  const others = await prisma.companyProfile.findMany({ where: { id: { notIn: ['default', DEFAULT_COMPANY_ID] } } });
  for (const other of others) {
    saveCompanyProfile(other.id, {
      name: other.name,
      email: other.email ?? undefined,
      phone: other.phone ?? undefined,
      industry: other.industry ?? undefined,
      industryKey: (other as { industryKey?: string | null }).industryKey ?? undefined,
      address: other.address ?? undefined,
    });
  }
}

// The default company's profile lives in the row with id 'default' (kept for existing databases); every other
// company's profile is the CompanyProfile row whose id is its company id.
const profileRowId = (companyId: string) => (companyId === DEFAULT_COMPANY_ID ? 'default' : companyId);

export async function persistCompanyProfile(profile: CompanyProfileRecord, companyId: string = DEFAULT_COMPANY_ID): Promise<void> {
  if (!databaseEnabled) return;
  requireDatabase();
  const id = profileRowId(companyId);
  await prisma.companyProfile.upsert({
    where: { id },
    update: { name: profile.name, email: profile.email, phone: profile.phone, industry: profile.industry, industryKey: profile.industryKey, address: profile.address },
    create: { id, name: profile.name, email: profile.email, phone: profile.phone, industry: profile.industry, industryKey: profile.industryKey, address: profile.address },
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
