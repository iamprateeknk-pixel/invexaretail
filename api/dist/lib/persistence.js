"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseEnabled = void 0;
exports.authenticateUser = authenticateUser;
exports.hydrateRepositoryFromDatabase = hydrateRepositoryFromDatabase;
exports.hydrateAuditFromDatabase = hydrateAuditFromDatabase;
exports.loadTransferPickSlips = loadTransferPickSlips;
exports.persistItem = persistItem;
exports.persistOpeningStockImport = persistOpeningStockImport;
exports.persistDailyMovementImport = persistDailyMovementImport;
exports.persistCount = persistCount;
exports.listStockFromDatabase = listStockFromDatabase;
exports.persistCountReconciliation = persistCountReconciliation;
exports.persistCountReview = persistCountReview;
exports.persistCountAssignment = persistCountAssignment;
exports.persistCountAssignmentUpdate = persistCountAssignmentUpdate;
exports.persistAssignmentSubmitted = persistAssignmentSubmitted;
exports.persistTransfer = persistTransfer;
exports.persistTransferStatus = persistTransferStatus;
exports.persistConfirmedPickAllocations = persistConfirmedPickAllocations;
exports.persistEnterpriseUser = persistEnterpriseUser;
exports.hydrateAuthUsers = hydrateAuthUsers;
exports.hydrateCompanyProfile = hydrateCompanyProfile;
exports.persistCompanyProfile = persistCompanyProfile;
exports.persistLocationCreate = persistLocationCreate;
exports.persistLocationUpdate = persistLocationUpdate;
exports.persistLocationDelete = persistLocationDelete;
exports.persistUserCreate = persistUserCreate;
exports.persistUserUpdate = persistUserUpdate;
exports.persistUserDelete = persistUserDelete;
exports.persistAudit = persistAudit;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_js_1 = require("./db.js");
const repository_js_1 = require("./repository.js");
const enterprise_repository_js_1 = require("./enterprise-repository.js");
const stock_import_js_1 = require("./stock-import.js");
const industry_packs_js_1 = require("./industry-packs.js");
const tenant_scope_js_1 = require("./saas/tenant-scope.js");
exports.databaseEnabled = Boolean((0, db_js_1.resolveDatabaseUrl)());
const demoUsers = {
    'admin@retail.local': { id: 'user-admin-1', email: 'admin@retail.local', role: 'ADMIN', assignedLocationIds: ['loc-1', 'loc-2', 'wh-1'] },
    'manager@retail.local': { id: 'user-manager-1', email: 'manager@retail.local', role: 'BRANCH_MANAGER', assignedLocationIds: ['loc-1'] },
    'store@retail.local': { id: 'user-store-1', email: 'store@retail.local', role: 'STORE_USER', assignedLocationIds: ['loc-1'] },
    'picker@retail.local': { id: 'user-picker-1', email: 'picker@retail.local', role: 'WAREHOUSE_PICKER', assignedLocationIds: ['wh-1'] },
    'auditor@retail.local': { id: 'user-auditor-1', email: 'auditor@retail.local', role: 'AUDITOR', assignedLocationIds: ['loc-1'] },
};
function parseAssignedLocations(value) {
    if (Array.isArray(value))
        return value.filter((entry) => typeof entry === 'string');
    if (typeof value !== 'string' || !value.trim())
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
    }
    catch {
        // Legacy Hostinger rows can contain blank or malformed assignment data.
        // Authentication must remain available; an admin can repair assignments.
        return [];
    }
}
async function authenticateUser(email, password, requestedRole) {
    if (!exports.databaseEnabled) {
        const user = demoUsers[email.toLowerCase()];
        const developmentPassword = process.env.SEED_PASSWORD;
        if (!developmentPassword || !user || password !== developmentPassword)
            throw new Error('Invalid email or password.');
        if (requestedRole && requestedRole !== user.role)
            throw new Error('Requested role does not match the user.');
        return user;
    }
    const user = await db_js_1.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await bcryptjs_1.default.compare(password, user.passwordHash)))
        throw new Error('Invalid email or password.');
    return {
        id: user.id,
        email: user.email,
        role: user.role,
        assignedLocationIds: parseAssignedLocations(user.assignedLocations),
    };
}
function requireDatabase() {
    if (!exports.databaseEnabled) {
        throw new Error('Database persistence is disabled. Set DATABASE_URL to the Hostinger MySQL database.');
    }
}
async function hydrateRepositoryFromDatabase() {
    if (!exports.databaseEnabled)
        return;
    const [dbLocations, dbItems, dbCounts, dbTransfers, dbStockLedger, dbAssignments, dbUsers] = await Promise.all([
        db_js_1.prisma.location.findMany(),
        db_js_1.prisma.item.findMany({ include: { lots: true } }),
        db_js_1.prisma.stockCount.findMany(),
        db_js_1.prisma.transfer.findMany({ include: { lines: true } }),
        db_js_1.prisma.stockLedger.findMany(),
        db_js_1.prisma.countAssignment.findMany(),
        db_js_1.prisma.user.findMany(),
    ]);
    repository_js_1.locations.splice(0, repository_js_1.locations.length, ...dbLocations.map((location) => ({
        id: location.id,
        name: location.name,
        type: location.type,
    })));
    repository_js_1.items.splice(0, repository_js_1.items.length, ...dbItems.map((item) => ({
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
        status: (item.status ?? 'ACTIVE'),
        archiveReason: item.archiveReason ?? undefined,
        archivedAt: item.archivedAt?.toISOString(),
        archivedById: item.archivedById ?? undefined,
        barcode: item.barcode ?? undefined,
        hsn: item.hsn ?? undefined,
        gstRate: item.gstRate ?? undefined,
        mrp: item.mrp ?? undefined,
        leadTimeDays: item.leadTimeDays ?? undefined,
        shelfLifeDays: item.shelfLifeDays ?? undefined,
        aliases: Array.isArray(item.aliases) ? item.aliases : undefined,
        version: item.version ?? 1,
        createdById: item.createdById ?? undefined,
        updatedById: item.updatedById ?? undefined,
        lots: item.lots.map((lot) => ({
            id: lot.id,
            itemId: lot.itemId,
            lotNo: lot.lotNo,
            expiryDate: lot.expiryDate?.toISOString() ?? null,
            status: lot.status ?? 'AVAILABLE',
            attributes: lot.attributes ?? undefined,
        })),
    })));
    (0, tenant_scope_js_1.adoptHydratedOwnership)({
        locations: dbLocations.map((location) => ({ id: location.id, companyId: location.companyId })),
        items: dbItems.map((item) => ({ id: item.id, companyId: item.companyId })),
    });
    repository_js_1.counts.splice(0, repository_js_1.counts.length, ...dbCounts.map((count) => ({
        id: count.id,
        itemId: count.itemId,
        lotId: count.lotId,
        locationId: count.locationId,
        physicalQuantity: count.physicalQty,
        bookQty: count.bookQty,
        mode: count.mode,
        submittedBy: count.submittedById,
        role: 'STORE_USER',
        createdAt: count.createdAt.toISOString(),
        status: count.reviewStatus,
        reviewedBy: count.approvedById ?? undefined,
        reviewedAt: count.approvedAt?.toISOString(),
        reviewReason: count.reviewReason ?? undefined,
        parentCountId: count.parentCountId ?? undefined,
        reconciliationRequired: count.reconciliationRequired ?? false,
        reconciliationNote: count.reconciliationNote ?? undefined,
        reconciliationAt: count.reconciliationAt?.toISOString(),
        bookQtyOriginal: count.bookQtyOriginal ?? undefined,
        lateDelta: count.lateDelta ?? 0,
        lateMovementKeys: Array.isArray(count.lateMovementKeys) ? count.lateMovementKeys : undefined,
    })));
    repository_js_1.stockLedger.splice(0, repository_js_1.stockLedger.length, ...dbStockLedger.map((row) => ({
        itemId: row.itemId,
        lotId: row.lotId,
        locationId: row.locationId,
        onHand: row.onHand,
        quarantine: row.quarantine,
        version: row.version,
    })));
    repository_js_1.users.splice(0, repository_js_1.users.length, ...dbUsers.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        assignedLocationIds: parseAssignedLocations(user.assignedLocations),
    })));
    repository_js_1.countAssignments.splice(0, repository_js_1.countAssignments.length, ...dbAssignments.map((row) => ({
        id: row.id,
        locationId: row.locationId,
        itemId: row.itemId,
        assignedToId: row.assignedToId,
        assignedById: row.assignedById,
        countDate: row.countDate.toISOString(),
        dueDate: row.dueDate?.toISOString(),
        priority: row.priority || 'NORMAL',
        instructions: row.instructions ?? undefined,
        status: row.status,
        countId: row.countId ?? undefined,
        parentCountId: row.parentCountId ?? undefined,
        campaignId: row.campaignId ?? undefined,
        createdAt: row.createdAt.toISOString(),
    })));
    repository_js_1.transfers.splice(0, repository_js_1.transfers.length, ...dbTransfers.map((transfer) => ({
        id: transfer.id,
        sourceLocationId: transfer.sourceLocationId,
        destinationLocationId: transfer.destinationLocationId,
        requestedBy: transfer.requestedById,
        role: 'ADMIN',
        status: transfer.status,
        cartonCount: transfer.cartonCount ?? undefined,
        notes: transfer.notes ?? undefined,
        lines: transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, quantity: line.requestedQty, receivedQty: line.receivedQty, damagedQty: line.damagedQty, shortageQty: line.shortageQty ?? 0 })),
        createdAt: transfer.createdAt.toISOString(),
    })));
    // These tables were introduced after the original Hostinger deployment.
    // Keep startup compatible while the migration is pending, then hydrate them
    // normally once present so sync state survives an API restart.
    try {
        const [dbMovements, dbCheckpoints] = await Promise.all([
            db_js_1.prisma.inventoryMovement.findMany({ orderBy: { transactionAt: 'desc' }, take: 10_000 }),
            db_js_1.prisma.syncCheckpoint.findMany(),
        ]);
        repository_js_1.dailyMovements.splice(0, repository_js_1.dailyMovements.length, ...dbMovements.map((row) => ({
            id: row.id,
            dedupeKey: row.dedupeKey,
            itemId: row.itemId,
            lotId: row.lotId ?? undefined,
            locationId: row.locationId,
            movementType: row.movementType,
            qtyDelta: row.qtyDelta,
            transactionAt: row.transactionAt.toISOString(),
            sourceType: row.sourceType,
            sourceReference: row.sourceReference,
            importBatchId: row.importBatchId ?? undefined,
            createdById: row.createdById,
            metadata: row.metadata ?? undefined,
        })));
        repository_js_1.syncCheckpoints.splice(0, repository_js_1.syncCheckpoints.length, ...dbCheckpoints
            .filter((row) => row.sourceType === 'SALES' || row.sourceType === 'PURCHASE')
            .map((row) => ({
            locationId: row.locationId,
            sourceType: row.sourceType,
            syncedThroughAt: row.syncedThroughAt.toISOString(),
            lastImportBatchId: row.lastImportBatchId ?? '',
        })));
    }
    catch (error) {
        console.warn('Daily sync tables are not available yet; run the Hostinger migration.', error instanceof Error ? error.message : error);
    }
}
async function hydrateAuditFromDatabase() {
    if (!exports.databaseEnabled)
        return [];
    const rows = await db_js_1.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorRole: row.actorRole,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata ?? undefined,
        createdAt: row.createdAt.toISOString(),
    }));
}
async function loadTransferPickSlips(transferId) {
    if (!exports.databaseEnabled)
        return [];
    const rows = await db_js_1.prisma.auditLog.findMany({
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
        metadata: row.metadata ?? undefined,
        createdAt: row.createdAt.toISOString(),
    }));
}
async function persistItem(item, companyId = 'default-company') {
    if (!exports.databaseEnabled)
        return;
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
        aliases: (item.aliases?.length ? item.aliases : client_1.Prisma.JsonNull),
        version: item.version ?? 1,
        createdById: item.createdById ?? null,
        updatedById: item.updatedById ?? null,
    };
    await db_js_1.prisma.item.upsert({
        where: { id: item.id },
        update: { code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, unit: item.unit, ...operationalFields, ...masterFields },
        create: { id: item.id, code: item.code, name: item.name, category: item.category, subcategory: item.subcategory, company: item.company, companyId, tenantId: tenant_scope_js_1.DEFAULT_TENANT_ID, unit: item.unit, ...operationalFields, ...masterFields },
    });
    for (const lot of item.lots) {
        await db_js_1.prisma.lot.upsert({
            where: { id: lot.id },
            update: { lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes },
            create: { id: lot.id, itemId: lot.itemId, lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes },
        });
    }
}
function importId(prefix, value) {
    return `${prefix}-${(0, node_crypto_1.createHash)('sha1').update(value.trim().toLowerCase()).digest('hex').slice(0, 20)}`;
}
/**
 * Commits a validated opening-stock workbook as an immutable snapshot and sets
 * current on-hand for each matching location/item/lot. IDs are deterministic,
 * so retrying after a network interruption cannot create duplicate masters.
 */
async function persistOpeningStockImport(preview, fileName, importedBy, options) {
    const companyId = options?.companyId || 'default-company';
    const rows = (0, stock_import_js_1.aggregateOpeningStock)(preview.validRows);
    const locationMap = new Map(repository_js_1.locations.map((row) => [row.name.trim().toLowerCase(), row]));
    const itemCodeMap = new Map(repository_js_1.items.map((row) => [row.code.trim().toLowerCase(), row]));
    const itemNameMap = new Map(repository_js_1.items.map((row) => [`${(row.category ?? '').trim().toLowerCase()}|${row.name.trim().toLowerCase()}`, row]));
    const newLocations = [];
    const newItems = [];
    const touchedItems = new Map();
    const newLots = [];
    const lotMap = new Map(repository_js_1.items.flatMap((item) => item.lots.map((lot) => [`${item.id}|${lot.lotNo.trim().toLowerCase()}`, lot])));
    const prepared = rows.map((row) => {
        const locationKey = row.locationName.trim().toLowerCase();
        let location = locationMap.get(locationKey);
        if (!location) {
            const normalizedLocation = row.locationName.toLowerCase().replace(/[^a-z0-9]+/g, '');
            location = { id: importId('loc-erp', locationKey), name: row.locationName, type: normalizedLocation === 'hobasni' || normalizedLocation === 'basni' ? 'warehouse' : 'store' };
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
        }
        else {
            item.name = row.itemName || item.name;
            item.category = row.category || item.category;
            item.subcategory = row.subcategory || item.subcategory;
            item.company = row.companyName || item.company;
            item.unit = row.unit || item.unit;
        }
        touchedItems.set(item.id, item);
        const lotKey = row.lotNo.trim().toLowerCase();
        let lot = lotMap.get(`${item.id}|${lotKey}`);
        if (!lot) {
            lot = {
                id: importId('lot-erp', `${item.id}|${lotKey}`),
                itemId: item.id,
                lotNo: row.lotNo,
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
        }
        else if (row.expiryDate) {
            lot.expiryDate = row.expiryDate;
        }
        return { row, item, lot, location };
    });
    const batchId = options?.batchId ?? importId('imp-opening', `${fileName}|${importedBy}|${Date.now()}`);
    if (exports.databaseEnabled) {
        requireDatabase();
        await db_js_1.prisma.$transaction(async (tx) => {
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
                await tx.$executeRaw(client_1.Prisma.sql `
          INSERT INTO Item (id, code, name, category, subcategory, company, companyId, unit, createdAt, updatedAt)
          VALUES ${client_1.Prisma.join(chunk.map((item) => client_1.Prisma.sql `(
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
                        attributes: lot.attributes,
                    })),
                    skipDuplicates: true,
                });
            }
            const lotsWithExpiry = [...lotMap.values()].filter((lot) => lot.expiryDate);
            for (let offset = 0; offset < lotsWithExpiry.length; offset += 400) {
                const chunk = lotsWithExpiry.slice(offset, offset + 400);
                await tx.$executeRaw(client_1.Prisma.sql `
          UPDATE Lot SET expiryDate = CASE id
            ${client_1.Prisma.join(chunk.map((lot) => client_1.Prisma.sql `WHEN ${lot.id} THEN ${new Date(lot.expiryDate)}`), ' ')}
          END, updatedAt = NOW()
          WHERE id IN (${client_1.Prisma.join(chunk.map((lot) => client_1.Prisma.sql `${lot.id}`))})
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
                await tx.$executeRaw(client_1.Prisma.sql `
          INSERT INTO StockLedger (id, itemId, lotId, locationId, onHand, reserved, inTransit, version, lastUpdatedAt)
          VALUES ${client_1.Prisma.join(chunk.map(({ row, item, lot, location }) => client_1.Prisma.sql `(
            ${importId('stock', `${item.id}|${lot.id}|${location.id}`)}, ${item.id}, ${lot.id}, ${location.id},
            ${row.quantity ?? 0}, 0, 0, 1, NOW()
          )`))}
          ON DUPLICATE KEY UPDATE onHand = VALUES(onHand), version = version + 1, lastUpdatedAt = NOW()
        `);
            }
        }, { maxWait: 10_000, timeout: 120_000 });
    }
    repository_js_1.locations.push(...newLocations);
    repository_js_1.items.push(...newItems);
    for (const location of newLocations)
        (0, tenant_scope_js_1.registerLocationCompany)(location.id, companyId);
    for (const item of newItems)
        (0, tenant_scope_js_1.registerItemCompany)(item.id, companyId);
    for (const lot of newLots) {
        const item = repository_js_1.items.find((candidate) => candidate.id === lot.itemId);
        if (item && !item.lots.some((candidate) => candidate.id === lot.id))
            item.lots.push(lot);
    }
    for (const { row, item, lot, location } of prepared) {
        const existing = repository_js_1.stockLedger.find((entry) => entry.itemId === item.id && entry.lotId === lot.id && entry.locationId === location.id);
        if (existing) {
            existing.onHand = row.quantity ?? 0;
            existing.version += 1;
        }
        else {
            repository_js_1.stockLedger.push({ itemId: item.id, lotId: lot.id, locationId: location.id, onHand: row.quantity ?? 0, quarantine: 0, version: 1 });
        }
    }
    return { batchId, importedItems: newItems.length, importedLots: newLots.length, importedLocations: newLocations.length, stockRows: prepared.length };
}
async function persistDailyMovementImport(input) {
    if (!exports.databaseEnabled)
        return { committedRows: input.movements.length };
    requireDatabase();
    let committedRows = 0;
    await db_js_1.prisma.$transaction(async (tx) => {
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
        for (const lot of input.lots)
            await tx.lot.upsert({ where: { itemId_lotNo: { itemId: lot.itemId, lotNo: lot.lotNo } }, update: { expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : undefined, attributes: lot.attributes }, create: { id: lot.id, itemId: lot.itemId, lotNo: lot.lotNo, expiryDate: lot.expiryDate ? new Date(lot.expiryDate) : null, attributes: lot.attributes } });
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
            if (!fresh.length)
                continue;
            await tx.inventoryMovement.createMany({
                data: fresh.map((movement) => ({ id: movement.id, dedupeKey: movement.dedupeKey, itemId: movement.itemId, lotId: movement.lotId, locationId: movement.locationId, movementType: movement.movementType, qtyDelta: movement.qtyDelta, transactionAt: new Date(movement.transactionAt), sourceType: movement.sourceType, sourceReference: movement.sourceReference, importBatchId: input.batchId, createdById: movement.createdById, metadata: movement.metadata })),
                skipDuplicates: true,
            });
            committedRows += fresh.length;
            const ledgerRows = fresh.filter((movement) => movement.lotId);
            if (ledgerRows.length) {
                await tx.$executeRaw(client_1.Prisma.sql `
          INSERT INTO StockLedger (id, itemId, lotId, locationId, onHand, reserved, inTransit, version, lastUpdatedAt)
          VALUES ${client_1.Prisma.join(ledgerRows.map((movement) => client_1.Prisma.sql `(
            ${importId('stock', `${movement.itemId}|${movement.lotId}|${movement.locationId}`)},
            ${movement.itemId}, ${movement.lotId}, ${movement.locationId}, ${movement.qtyDelta}, 0, 0, 1, NOW()
          )`))}
          ON DUPLICATE KEY UPDATE onHand = onHand + VALUES(onHand), version = version + 1, lastUpdatedAt = NOW()
        `);
            }
        }
        for (const checkpoint of input.checkpoints) {
            const key = { locationId_sourceType: { locationId: checkpoint.locationId, sourceType: checkpoint.sourceType } };
            const next = new Date(checkpoint.syncedThroughAt);
            const existing = await tx.syncCheckpoint.findUnique({ where: key });
            // Only ever move forward: a backfill of an older day must not regress the branch.
            if (existing && existing.syncedThroughAt >= next)
                continue;
            await tx.syncCheckpoint.upsert({ where: key, update: { syncedThroughAt: next, lastImportBatchId: input.batchId }, create: { locationId: checkpoint.locationId, sourceType: checkpoint.sourceType, syncedThroughAt: next, lastImportBatchId: input.batchId } });
        }
    }, { maxWait: 10_000, timeout: 120_000 });
    return { committedRows };
}
async function persistCount(count) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.stockCount.upsert({
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
async function listStockFromDatabase(locationId) {
    requireDatabase();
    const rows = await db_js_1.prisma.stockLedger.findMany({ where: { locationId } });
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
async function persistCountReconciliation(count) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.stockCount.update({
        where: { id: count.id },
        data: {
            bookQty: count.bookQty,
            reconciliationRequired: count.reconciliationRequired ?? false,
            reconciliationNote: count.reconciliationNote ?? null,
            reconciliationAt: count.reconciliationAt ? new Date(count.reconciliationAt) : null,
            bookQtyOriginal: count.bookQtyOriginal ?? null,
            lateDelta: count.lateDelta ?? 0,
            lateMovementKeys: (count.lateMovementKeys ?? []),
        },
    });
}
async function persistCountReview(count) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.$transaction(async (tx) => {
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
        if (claimed.count !== 1)
            throw new Error('Stock count was already reviewed; variance was not posted again.');
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
async function persistCountAssignment(assignment) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.countAssignment.create({
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
        },
    });
}
async function persistCountAssignmentUpdate(assignment) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.countAssignment.update({
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
async function persistAssignmentSubmitted(assignmentId, countId) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.countAssignment.update({ where: { id: assignmentId }, data: { status: 'SUBMITTED', countId } });
}
async function persistTransfer(transfer) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    const status = transfer.status === 'SUBMITTED' ? 'REQUESTED' : transfer.status === 'PARTIALLY_RECEIVED' ? 'PARTIAL_RECEIVED' : transfer.status;
    await db_js_1.prisma.transfer.upsert({
        where: { id: transfer.id },
        update: { status: status, notes: transfer.notes, cartonCount: transfer.cartonCount ?? null },
        create: {
            id: transfer.id,
            sourceLocationId: transfer.sourceLocationId,
            destinationLocationId: transfer.destinationLocationId,
            requestedById: transfer.requestedBy,
            status: status,
            notes: transfer.notes,
            cartonCount: transfer.cartonCount ?? null,
            lines: { create: transfer.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity })) },
        },
    });
}
async function persistTransferStatus(transfer) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    const status = transfer.status === 'SUBMITTED' ? 'REQUESTED' : transfer.status === 'PARTIALLY_RECEIVED' ? 'PARTIAL_RECEIVED' : transfer.status;
    await db_js_1.prisma.transfer.update({ where: { id: transfer.id }, data: { status: status } });
}
async function persistConfirmedPickAllocations(transferId, allocations) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.$transaction(async (tx) => {
        const transfer = await tx.transfer.findUnique({ where: { id: transferId } });
        if (!transfer)
            throw new Error('Transfer was not found.');
        if (['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED', 'CLOSED'].includes(String(transfer.status))) {
            throw new Error('Transfer is already confirmed and stock cannot be deducted twice.');
        }
        for (const allocation of allocations) {
            const ledger = await tx.stockLedger.findUnique({
                where: { itemId_lotId_locationId: { itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId } },
            });
            if (!ledger || ledger.onHand < allocation.quantity)
                throw new Error(`Insufficient current stock for lot ${allocation.lotId}.`);
            await tx.stockLedger.update({
                where: { itemId_lotId_locationId: { itemId: allocation.itemId, lotId: allocation.lotId, locationId: allocation.locationId } },
                data: { onHand: { decrement: allocation.quantity }, version: { increment: 1 } },
            });
        }
        await tx.transfer.update({ where: { id: transferId }, data: { status: 'CONFIRMED' } });
    }, { maxWait: 10_000, timeout: 60_000 });
}
// Company self-registration writes the new admin into enhancedUsers (see
// enterprise-repository.ts) so it can log in immediately, but that array is
// in-memory only and startup's hydrateDatabase() (index.ts) overwrites it
// wholesale from the User table on every restart. Without this, a user
// created after boot is silently gone on the next one - not because the
// process restarted, but because hydration replaces the very array their
// row lived in with what the database has, which never received it either.
async function persistEnterpriseUser(user) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.user.create({
        data: {
            id: user.id,
            name: user.name,
            email: user.email.toLowerCase(),
            passwordHash: user.passwordHash,
            role: user.role,
            assignedLocations: JSON.stringify(user.locationIds ?? []),
            companyId: user.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
        },
    });
}
async function hydrateAuthUsers() {
    if (!exports.databaseEnabled)
        return enterprise_repository_js_1.enhancedUsers.length;
    requireDatabase();
    const { ensureDailySyncSchema } = await import('./runtime-schema.js');
    await db_js_1.prisma.$queryRaw `SELECT 1`;
    await ensureDailySyncSchema();
    const dbUsers = await db_js_1.prisma.user.findMany();
    enterprise_repository_js_1.enhancedUsers.length = 0;
    for (const user of dbUsers) {
        enterprise_repository_js_1.enhancedUsers.push({
            id: user.id,
            companyId: user.companyId || tenant_scope_js_1.DEFAULT_COMPANY_ID,
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
    return enterprise_repository_js_1.enhancedUsers.length;
}
async function hydrateCompanyProfile() {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    const row = await db_js_1.prisma.companyProfile.findUnique({ where: { id: 'default' } });
    if (row) {
        (0, repository_js_1.setCompanyProfile)({
            name: row.name,
            email: row.email ?? undefined,
            phone: row.phone ?? undefined,
            industry: row.industry ?? undefined,
            industryKey: row.industryKey ?? undefined,
            address: row.address ?? undefined,
        });
        await (0, industry_packs_js_1.hydrateActiveWorkflow)(row.industryKey ?? row.industry);
    }
}
async function persistCompanyProfile(profile) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.companyProfile.upsert({
        where: { id: 'default' },
        update: { name: profile.name, email: profile.email, phone: profile.phone, industry: profile.industry, industryKey: profile.industryKey, address: profile.address },
        create: { id: 'default', name: profile.name, email: profile.email, phone: profile.phone, industry: profile.industry, industryKey: profile.industryKey, address: profile.address },
    });
}
async function persistLocationCreate(location, code, companyId = tenant_scope_js_1.DEFAULT_COMPANY_ID) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.location.create({ data: { id: location.id, code, name: location.name, type: location.type, companyId, tenantId: tenant_scope_js_1.DEFAULT_TENANT_ID } });
}
async function persistLocationUpdate(location) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.location.update({ where: { id: location.id }, data: { name: location.name, type: location.type } });
}
async function persistLocationDelete(locationId) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.location.delete({ where: { id: locationId } });
}
async function persistUserCreate(user, passwordHash, companyId = tenant_scope_js_1.DEFAULT_COMPANY_ID) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.user.create({
        data: {
            id: user.id,
            name: user.name,
            email: user.email.toLowerCase(),
            passwordHash,
            role: user.role,
            assignedLocations: JSON.stringify(user.assignedLocationIds ?? []),
            companyId,
            tenantId: tenant_scope_js_1.DEFAULT_TENANT_ID,
        },
    });
}
async function persistUserUpdate(user, passwordHash) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.user.update({
        where: { id: user.id },
        data: {
            name: user.name,
            role: user.role,
            assignedLocations: JSON.stringify(user.assignedLocationIds ?? []),
            ...(passwordHash ? { passwordHash } : {}),
        },
    });
}
async function persistUserDelete(userId) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.user.delete({ where: { id: userId } });
}
async function persistAudit(event) {
    if (!exports.databaseEnabled)
        return;
    requireDatabase();
    await db_js_1.prisma.auditLog.upsert({
        where: { id: event.id },
        update: { action: event.action, metadata: event.metadata },
        create: {
            id: event.id,
            actorId: event.actorId,
            actorRole: event.actorRole,
            action: event.action,
            entityType: event.entityType,
            entityId: event.entityId,
            metadata: event.metadata,
            createdAt: new Date(event.createdAt),
        },
    });
}
