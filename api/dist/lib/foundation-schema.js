"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPERATIONAL_TENANT_TABLES = void 0;
exports.ensureFoundationSchema = ensureFoundationSchema;
const db_js_1 = require("./db.js");
async function ensureColumn(table, column, definition) {
    const rows = await db_js_1.prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', table, column);
    if (Number(rows[0]?.count ?? 0) > 0)
        return;
    await db_js_1.prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}
exports.OPERATIONAL_TENANT_TABLES = [
    'Lot', 'StockLedger', 'StockCount', 'CountAssignment', 'Transfer', 'TransferLine',
    'TransferReceipt', 'TransferReceiptLine', 'TransferCarton', 'InventoryMovement',
    'StockMovement', 'StockBalance', 'OpeningStockSnapshot', 'PurchaseOrder',
    'PurchaseOrderLine', 'Supplier', 'ReorderRule', 'SyncCheckpoint',
    'WebhookSubscription', 'WebhookDeliveryLog', 'ImportBatch', 'ImportRow',
    'Order', 'OrderLine', 'AuditLog', 'Bin', 'PutawayTask', 'PickWave',
    'ExpiryAlert', 'ReplenishmentSuggestion', 'ExceptionCase', 'QcInspection',
    'AssetCheckout', 'Job', 'JobLine', 'CompanyProfile', 'SavedReport',
];
async function tableExists(table) {
    const rows = await db_js_1.prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', table);
    return Number(rows[0]?.count ?? 0) > 0;
}
async function ensureTenantId(table) {
    if (!(await tableExists(table)))
        return;
    await ensureColumn(table, 'tenantId', "VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa'");
    await ensureIndex(table, `${table}_tenantId_idx`, '`tenantId`');
}
async function ensureIndex(table, index, columns) {
    const rows = await db_js_1.prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', table, index);
    if (Number(rows[0]?.count ?? 0) > 0)
        return;
    await db_js_1.prisma.$executeRawUnsafe(`CREATE INDEX \`${index}\` ON \`${table}\` (${columns})`);
}
/**
 * Applies the additive schema introduced by the Operations OS foundation.
 * Hostinger shared hosting has no reliable release/migration hook, so this
 * runs before hydration and never drops, truncates or rewrites business data.
 */
async function ensureFoundationSchema() {
    await ensureColumn('User', 'assignedBranches', 'TEXT NULL');
    await ensureColumn('User', 'lastLoginAt', 'DATETIME(3) NULL');
    await ensureColumn('User', 'mfaEnabled', 'BOOLEAN NOT NULL DEFAULT false');
    await ensureColumn('User', 'otpSecret', 'VARCHAR(191) NULL');
    await ensureColumn('User', 'passwordChangedAt', 'DATETIME(3) NULL');
    await ensureColumn('User', 'status', "ENUM('ACTIVE','INACTIVE','SUSPENDED','LOCKED') NOT NULL DEFAULT 'ACTIVE'");
    await ensureColumn('User', 'suspendedReason', 'VARCHAR(191) NULL');
    await ensureColumn('Location', 'branchId', 'VARCHAR(191) NULL');
    await ensureColumn('Location', 'description', 'TEXT NULL');
    await ensureColumn('Location', 'locationType', "VARCHAR(191) NULL DEFAULT 'STANDARD'");
    await ensureColumn('Location', 'status', "VARCHAR(191) NOT NULL DEFAULT 'ACTIVE'");
    await ensureColumn('Location', 'companyId', "VARCHAR(191) NOT NULL DEFAULT 'default-company'");
    await ensureIndex('Location', 'Location_companyId_idx', '`companyId`');
    await ensureColumn('Branch', 'companyId', "VARCHAR(191) NOT NULL DEFAULT 'default-company'");
    await ensureIndex('Branch', 'Branch_companyId_idx', '`companyId`');
    await ensureColumn('User', 'companyId', "VARCHAR(191) NOT NULL DEFAULT 'default-company'");
    await ensureIndex('User', 'User_companyId_idx', '`companyId`');
    // Item.description was added to Prisma after the original Hostinger schema.
    // Prisma selects every scalar field for findMany(), so a missing optional
    // column prevents the entire inventory repository from hydrating.
    await ensureColumn('Item', 'description', 'TEXT NULL');
    await ensureColumn('Item', 'subcategory', 'VARCHAR(191) NULL');
    await ensureColumn('Item', 'company', 'VARCHAR(191) NULL');
    await ensureColumn('Item', 'companyId', "VARCHAR(191) NOT NULL DEFAULT 'default-company'");
    await ensureIndex('Item', 'Item_companyId_idx', '`companyId`');
    await ensureColumn('User', 'tenantId', "VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa'");
    await ensureIndex('User', 'User_tenantId_idx', '`tenantId`');
    await ensureColumn('Branch', 'tenantId', "VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa'");
    await ensureIndex('Branch', 'Branch_tenantId_idx', '`tenantId`');
    await ensureColumn('Location', 'tenantId', "VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa'");
    await ensureIndex('Location', 'Location_tenantId_idx', '`tenantId`');
    await ensureColumn('Item', 'tenantId', "VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa'");
    await ensureIndex('Item', 'Item_tenantId_idx', '`tenantId`');
    // Blueprint v4 §6 Item Master operational fields. Same hydration hazard as
    // Item.description above: findMany() selects every scalar, so a database
    // that has not run the migration must still get these columns.
    await ensureColumn('Item', 'countMethod', "VARCHAR(191) NOT NULL DEFAULT 'LOT_SCAN'");
    await ensureColumn('Item', 'pickMethod', "VARCHAR(191) NOT NULL DEFAULT 'LOT_SCAN'");
    await ensureColumn('Item', 'allocationStrategy', "VARCHAR(191) NOT NULL DEFAULT 'FEFO'");
    await ensureColumn('Item', 'lotRequired', 'BOOLEAN NOT NULL DEFAULT true');
    await ensureColumn('Item', 'expiryRequired', 'BOOLEAN NOT NULL DEFAULT false');
    await ensureColumn('Item', 'decimalQuantity', 'BOOLEAN NOT NULL DEFAULT false');
    // Blueprint v4 §6 canonical Item Master fields.
    await ensureColumn('Item', 'status', "VARCHAR(191) NOT NULL DEFAULT 'ACTIVE'");
    await ensureColumn('Item', 'archiveReason', 'VARCHAR(191) NULL');
    await ensureColumn('Item', 'archivedAt', 'DATETIME(3) NULL');
    await ensureColumn('Item', 'archivedById', 'VARCHAR(191) NULL');
    await ensureColumn('Item', 'barcode', 'VARCHAR(191) NULL');
    await ensureColumn('Item', 'hsn', 'VARCHAR(191) NULL');
    await ensureColumn('Item', 'gstRate', 'DOUBLE NULL');
    await ensureColumn('Item', 'mrp', 'DOUBLE NULL');
    await ensureColumn('Item', 'leadTimeDays', 'INTEGER NULL');
    await ensureColumn('Item', 'shelfLifeDays', 'INTEGER NULL');
    await ensureColumn('Item', 'aliases', 'JSON NULL');
    await ensureColumn('Item', 'version', 'INTEGER NOT NULL DEFAULT 1');
    await ensureColumn('Item', 'createdById', 'VARCHAR(191) NULL');
    await ensureColumn('Item', 'updatedById', 'VARCHAR(191) NULL');
    // Blueprint v4 §14 late-arriving movement reconciliation on counts.
    await ensureColumn('Transfer', 'logistics', 'JSON NULL');
    await ensureColumn('StockCount', 'reconciliationRequired', 'BOOLEAN NOT NULL DEFAULT false');
    await ensureColumn('StockCount', 'reconciliationNote', 'TEXT NULL');
    await ensureColumn('StockCount', 'reconciliationAt', 'DATETIME(3) NULL');
    await ensureColumn('StockCount', 'bookQtyOriginal', 'DOUBLE NULL');
    await ensureColumn('StockCount', 'lateDelta', 'DOUBLE NOT NULL DEFAULT 0');
    await ensureColumn('StockCount', 'lateMovementKeys', 'JSON NULL');
    await ensureIndex('StockCount', 'StockCount_reconciliationRequired_idx', '`reconciliationRequired`');
    await ensureColumn('StockCount', 'requestId', 'VARCHAR(191) NULL');
    await ensureIndex('StockCount', 'StockCount_submittedById_requestId_idx', '`submittedById`, `requestId`');
    await ensureIndex('Item', 'Item_status_idx', '`status`');
    await ensureIndex('Item', 'Item_barcode_idx', '`barcode`');
    // Blueprint v4 §12 stock-take campaigns: assignments created by a
    // campaign's daily allocation carry its id (countAssignment.findMany()
    // selects every scalar during hydration, too).
    await ensureColumn('CountAssignment', 'campaignId', 'VARCHAR(191) NULL');
    await ensureIndex('CountAssignment', 'CountAssignment_campaignId_idx', '`campaignId`');
    await db_js_1.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`StockTakeCampaign\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`companyId\` VARCHAR(191) NOT NULL DEFAULT 'default-company',
    \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
    \`name\` VARCHAR(191) NOT NULL,
    \`locationId\` VARCHAR(191) NOT NULL,
    \`status\` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    \`dailyItemsPerUser\` INTEGER NOT NULL,
    \`userIds\` JSON NOT NULL,
    \`priorityOrder\` JSON NOT NULL,
    \`includeNewStock\` BOOLEAN NOT NULL DEFAULT true,
    \`timezone\` VARCHAR(191) NOT NULL DEFAULT 'Asia/Kolkata',
    \`startDate\` VARCHAR(191) NOT NULL,
    \`endDate\` VARCHAR(191) NULL,
    \`lastRunDate\` VARCHAR(191) NULL,
    \`pausedFrom\` VARCHAR(191) NULL,
    \`createdById\` VARCHAR(191) NOT NULL,
    \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updatedAt\` DATETIME(3) NOT NULL,
    \`activatedAt\` DATETIME(3) NULL,
    \`completedAt\` DATETIME(3) NULL,
    \`cancelledAt\` DATETIME(3) NULL,
    PRIMARY KEY (\`id\`),
    INDEX \`StockTakeCampaign_companyId_locationId_status_idx\` (\`companyId\`, \`locationId\`, \`status\`),
    INDEX \`StockTakeCampaign_tenantId_idx\` (\`tenantId\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db_js_1.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`StockTakeCampaignItem\` (
    \`campaignId\` VARCHAR(191) NOT NULL,
    \`itemId\` VARCHAR(191) NOT NULL,
    \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    \`excludedReason\` VARCHAR(191) NULL,
    \`assignedToId\` VARCHAR(191) NULL,
    \`assignmentId\` VARCHAR(191) NULL,
    \`countId\` VARCHAR(191) NULL,
    \`assignedDate\` DATETIME(3) NULL,
    \`lastCountedAt\` DATETIME(3) NULL,
    \`recounts\` INTEGER NOT NULL DEFAULT 0,
    \`addedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updatedAt\` DATETIME(3) NOT NULL,
    PRIMARY KEY (\`campaignId\`, \`itemId\`),
    INDEX \`StockTakeCampaignItem_campaignId_status_idx\` (\`campaignId\`, \`status\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await ensureColumn('Lot', 'status', "VARCHAR(191) NOT NULL DEFAULT 'AVAILABLE'");
    await ensureColumn('CompanyProfile', 'industryKey', 'VARCHAR(191) NULL');
    // P5 receiving persists cumulative discrepancies per transfer lot. Prisma
    // selects every TransferLine scalar during startup hydration, so this must
    // exist before hydrateRepositoryFromDatabase() runs on older Hostinger DBs.
    await ensureColumn('TransferLine', 'shortageQty', 'DOUBLE NOT NULL DEFAULT 0');
    // Blueprint Module H: excess receipt must never be silently absorbed.
    await ensureColumn('TransferLine', 'excessQty', 'DOUBLE NOT NULL DEFAULT 0');
    await ensureColumn('AuditLog', 'branchId', 'VARCHAR(191) NULL');
    await ensureColumn('AuditLog', 'correlationId', 'VARCHAR(191) NULL');
    await ensureColumn('AuditLog', 'newValues', 'JSON NULL');
    await ensureColumn('AuditLog', 'oldValues', 'JSON NULL');
    await ensureColumn('AuditLog', 'reason', 'TEXT NULL');
    await ensureColumn('AuditLog', 'sourceContext', 'TEXT NULL');
    await ensureColumn('ImportBatch', 'branchId', 'VARCHAR(191) NULL');
    await ensureColumn('ImportBatch', 'fileHash', 'VARCHAR(191) NULL');
    await ensureColumn('ImportBatch', 'sourceDateFrom', 'DATETIME(3) NULL');
    await ensureColumn('ImportBatch', 'sourceDateTo', 'DATETIME(3) NULL');
    await ensureColumn('ImportBatch', 'status', "VARCHAR(191) NOT NULL DEFAULT 'POSTED'");
    await ensureColumn('StockCount', 'reviewReason', 'TEXT NULL');
    await ensureColumn('StockCount', 'parentCountId', 'VARCHAR(191) NULL');
    await ensureColumn('CountAssignment', 'dueDate', 'DATETIME(3) NULL');
    await ensureColumn('CountAssignment', 'priority', "VARCHAR(191) NOT NULL DEFAULT 'NORMAL'");
    await ensureColumn('CountAssignment', 'parentCountId', 'VARCHAR(191) NULL');
    await ensureColumn('Transfer', 'cartonCount', 'INTEGER NULL');
    const tables = [
        `CREATE TABLE IF NOT EXISTS \`CompanyProfile\` (
      \`id\` VARCHAR(191) NOT NULL, \`name\` VARCHAR(191) NOT NULL,
      \`email\` VARCHAR(191) NULL, \`phone\` VARCHAR(191) NULL,
      \`industry\` VARCHAR(191) NULL, \`industryKey\` VARCHAR(191) NULL, \`address\` TEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`Branch\` (
      \`id\` VARCHAR(191) NOT NULL, \`code\` VARCHAR(191) NOT NULL, \`name\` VARCHAR(191) NOT NULL,
      \`type\` VARCHAR(191) NOT NULL DEFAULT 'WAREHOUSE', \`status\` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
      \`address\` TEXT NULL, \`phone\` VARCHAR(191) NULL, \`email\` VARCHAR(191) NULL,
      \`managerId\` VARCHAR(191) NULL, \`workingHours\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`Branch_code_key\` (\`code\`), INDEX \`Branch_code_status_idx\` (\`code\`, \`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`StockMovement\` (
      \`id\` VARCHAR(191) NOT NULL, \`itemId\` VARCHAR(191) NOT NULL, \`lotId\` VARCHAR(191) NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`movementType\` ENUM('OPENING_STOCK','PURCHASE_RECEIPT','SALES_DEDUCTION','SALES_RETURN','TRANSFER_OUT','TRANSFER_IN','COUNT_VARIANCE','ADJUSTMENT','WASTE','DAMAGE','EXPIRY_WRITE_OFF') NOT NULL,
      \`qtyDelta\` DOUBLE NOT NULL, \`beforeBalance\` DOUBLE NOT NULL, \`afterBalance\` DOUBLE NOT NULL,
      \`sourceDocument\` VARCHAR(191) NULL, \`sourceLineId\` VARCHAR(191) NULL, \`actor\` VARCHAR(191) NULL,
      \`timestamp\` DATETIME(3) NOT NULL, \`correlationId\` VARCHAR(191) NULL, \`reason\` TEXT NULL,
      \`metadata\` JSON NULL, \`posted\` BOOLEAN NOT NULL DEFAULT true,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), INDEX \`StockMovement_itemId_locationId_timestamp_idx\` (\`itemId\`,\`locationId\`,\`timestamp\`),
      INDEX \`StockMovement_correlationId_idx\` (\`correlationId\`), INDEX \`StockMovement_sourceDocument_sourceLineId_idx\` (\`sourceDocument\`,\`sourceLineId\`),
      INDEX \`StockMovement_timestamp_idx\` (\`timestamp\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`StockBalance\` (
      \`id\` VARCHAR(191) NOT NULL, \`itemId\` VARCHAR(191) NOT NULL, \`lotId\` VARCHAR(191) NULL,
      \`locationId\` VARCHAR(191) NOT NULL, \`onHand\` DOUBLE NOT NULL DEFAULT 0, \`reserved\` DOUBLE NOT NULL DEFAULT 0,
      \`inTransit\` DOUBLE NOT NULL DEFAULT 0, \`available\` DOUBLE NOT NULL DEFAULT 0, \`version\` INTEGER NOT NULL DEFAULT 0,
      \`lastPostedAt\` DATETIME(3) NOT NULL, PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`StockBalance_itemId_lotId_locationId_key\` (\`itemId\`,\`lotId\`,\`locationId\`),
      INDEX \`StockBalance_locationId_available_idx\` (\`locationId\`,\`available\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`Permission\` (
      \`id\` VARCHAR(191) NOT NULL, \`module\` VARCHAR(191) NOT NULL,
      \`action\` ENUM('VIEW','CREATE','EDIT','DELETE','APPROVE','EXPORT','ARCHIVE','REVERSE') NOT NULL,
      \`description\` VARCHAR(191) NULL, \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`Permission_module_action_key\` (\`module\`,\`action\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`RoleTemplate\` (
      \`id\` VARCHAR(191) NOT NULL, \`name\` VARCHAR(191) NOT NULL, \`description\` TEXT NULL,
      \`isSystemRole\` BOOLEAN NOT NULL DEFAULT false, \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL, PRIMARY KEY (\`id\`), UNIQUE INDEX \`RoleTemplate_name_key\` (\`name\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`RolePermission\` (
      \`id\` VARCHAR(191) NOT NULL, \`roleId\` VARCHAR(191) NOT NULL, \`permissionId\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`RolePermission_roleId_permissionId_key\` (\`roleId\`,\`permissionId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`UserRole\` (
      \`id\` VARCHAR(191) NOT NULL, \`userId\` VARCHAR(191) NOT NULL, \`roleId\` VARCHAR(191) NOT NULL,
      \`scopeId\` VARCHAR(191) NULL, \`scopeType\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`UserRole_userId_roleId_scopeId_key\` (\`userId\`,\`roleId\`,\`scopeId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`UserPermission\` (
      \`id\` VARCHAR(191) NOT NULL, \`userId\` VARCHAR(191) NOT NULL, \`permissionId\` VARCHAR(191) NOT NULL,
      \`allowed\` BOOLEAN NOT NULL DEFAULT true, \`denied\` BOOLEAN NOT NULL DEFAULT false,
      \`scopeId\` VARCHAR(191) NULL, \`scopeType\` VARCHAR(191) NULL, \`reason\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`UserPermission_userId_permissionId_scopeId_key\` (\`userId\`,\`permissionId\`,\`scopeId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`UserSession\` (
      \`id\` VARCHAR(191) NOT NULL, \`userId\` VARCHAR(191) NOT NULL, \`token\` VARCHAR(191) NOT NULL,
      \`deviceInfo\` VARCHAR(191) NULL, \`ipAddress\` VARCHAR(191) NULL, \`userAgent\` TEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`lastActivityAt\` DATETIME(3) NOT NULL, \`revokedAt\` DATETIME(3) NULL,
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`UserSession_token_key\` (\`token\`), INDEX \`UserSession_userId_revokedAt_idx\` (\`userId\`,\`revokedAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`LoginHistory\` (
      \`id\` VARCHAR(191) NOT NULL, \`userId\` VARCHAR(191) NOT NULL, \`device\` VARCHAR(191) NULL,
      \`ipAddress\` VARCHAR(191) NULL, \`userAgent\` TEXT NULL, \`status\` VARCHAR(191) NOT NULL DEFAULT 'SUCCESS',
      \`failureReason\` VARCHAR(191) NULL, \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (\`id\`),
      INDEX \`LoginHistory_userId_createdAt_idx\` (\`userId\`,\`createdAt\`), INDEX \`LoginHistory_createdAt_idx\` (\`createdAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`WorkAssignment\` (
      \`id\` VARCHAR(191) NOT NULL, \`type\` VARCHAR(191) NOT NULL, \`reference\` VARCHAR(191) NULL,
      \`title\` VARCHAR(191) NOT NULL, \`description\` TEXT NULL, \`branchId\` VARCHAR(191) NULL, \`locationId\` VARCHAR(191) NULL,
      \`assignedToId\` VARCHAR(191) NOT NULL, \`createdById\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'ASSIGNED', \`priority\` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
      \`dueAt\` DATETIME(3) NULL, \`slaMinutes\` INTEGER NULL, \`instructions\` TEXT NULL, \`checklist\` JSON NULL,
      \`progress\` INTEGER NOT NULL DEFAULT 0, \`startedAt\` DATETIME(3) NULL, \`submittedAt\` DATETIME(3) NULL,
      \`reviewedAt\` DATETIME(3) NULL, \`closedAt\` DATETIME(3) NULL, \`items\` JSON NULL, \`metadata\` JSON NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), INDEX \`WorkAssignment_assignedToId_status_idx\` (\`assignedToId\`,\`status\`),
      INDEX \`WorkAssignment_type_status_idx\` (\`type\`,\`status\`), INDEX \`WorkAssignment_dueAt_status_idx\` (\`dueAt\`,\`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`WorkComment\` (
      \`id\` VARCHAR(191) NOT NULL, \`workAssignmentId\` VARCHAR(191) NOT NULL, \`authorId\` VARCHAR(191) NOT NULL,
      \`body\` TEXT NOT NULL, \`mentions\` JSON NULL, \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL, PRIMARY KEY (\`id\`), INDEX \`WorkComment_workAssignmentId_createdAt_idx\` (\`workAssignmentId\`,\`createdAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`WorkAttachment\` (
      \`id\` VARCHAR(191) NOT NULL, \`workAssignmentId\` VARCHAR(191) NOT NULL, \`fileName\` VARCHAR(191) NOT NULL,
      \`fileUrl\` TEXT NOT NULL, \`fileType\` VARCHAR(191) NOT NULL, \`fileSize\` INTEGER NOT NULL,
      \`uploadedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (\`id\`),
      INDEX \`WorkAttachment_workAssignmentId_idx\` (\`workAssignmentId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`ExpiryAlert\` (
      \`id\` VARCHAR(191) NOT NULL, \`itemId\` VARCHAR(191) NOT NULL, \`lotId\` VARCHAR(191) NOT NULL, \`locationId\` VARCHAR(191) NOT NULL,
      \`quantity\` DOUBLE NOT NULL, \`value\` DOUBLE NULL, \`expiryDate\` DATETIME(3) NOT NULL, \`daysUntilExpiry\` INTEGER NOT NULL,
      \`status\` ENUM('ACTIVE','ACKNOWLEDGED','RESOLVED','RESOLVED_BY_TRANSFER','RESOLVED_BY_WRITE_OFF') NOT NULL DEFAULT 'ACTIVE',
      \`recommendedAction\` VARCHAR(191) NULL, \`metadata\` JSON NULL, \`acknowledgedAt\` DATETIME(3) NULL, \`resolvedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL, PRIMARY KEY (\`id\`),
      INDEX \`ExpiryAlert_status_locationId_expiryDate_idx\` (\`status\`,\`locationId\`,\`expiryDate\`), INDEX \`ExpiryAlert_itemId_expiryDate_idx\` (\`itemId\`,\`expiryDate\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`ReplenishmentSuggestion\` (
      \`id\` VARCHAR(191) NOT NULL, \`itemId\` VARCHAR(191) NOT NULL, \`locationId\` VARCHAR(191) NOT NULL, \`suggestType\` VARCHAR(191) NOT NULL,
      \`currentStock\` DOUBLE NOT NULL, \`minRequired\` DOUBLE NOT NULL, \`targetStock\` DOUBLE NOT NULL, \`suggestedQty\` DOUBLE NOT NULL,
      \`sourceLocation\` VARCHAR(191) NULL, \`salesVelocity\` DOUBLE NULL, \`daysOfCover\` DOUBLE NULL, \`priority\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING_REVIEW', \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), INDEX \`ReplenishmentSuggestion_locationId_status_priority_idx\` (\`locationId\`,\`status\`,\`priority\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`ImportRow\` (
      \`id\` VARCHAR(191) NOT NULL, \`importBatchId\` VARCHAR(191) NOT NULL, \`rowNumber\` INTEGER NOT NULL, \`rawData\` JSON NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'DRAFT', \`errors\` JSON NULL, \`warnings\` JSON NULL, \`mappedData\` JSON NULL,
      \`sourceKey\` VARCHAR(191) NULL, \`processedAt\` DATETIME(3) NULL, \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`ImportRow_importBatchId_rowNumber_key\` (\`importBatchId\`,\`rowNumber\`),
      INDEX \`ImportRow_importBatchId_status_idx\` (\`importBatchId\`,\`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`ImportTemplate\` (
      \`id\` VARCHAR(191) NOT NULL, \`name\` VARCHAR(191) NOT NULL, \`importType\` VARCHAR(191) NOT NULL,
      \`columnMapping\` JSON NOT NULL, \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`ImportTemplate_name_importType_key\` (\`name\`,\`importType\`), INDEX \`ImportTemplate_importType_idx\` (\`importType\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`TransferCarton\` (
      \`id\` VARCHAR(191) NOT NULL, \`transferId\` VARCHAR(191) NOT NULL, \`cartonNumber\` VARCHAR(191) NOT NULL,
      \`qrCode\` VARCHAR(191) NULL, \`contents\` JSON NULL, \`quantity\` DOUBLE NOT NULL, \`weight\` DOUBLE NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'PACKED', \`photoUrl\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`TransferCarton_transferId_cartonNumber_key\` (\`transferId\`,\`cartonNumber\`),
      INDEX \`TransferCarton_transferId_status_idx\` (\`transferId\`,\`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`FeatureFlag\` (
      \`id\` VARCHAR(191) NOT NULL, \`name\` VARCHAR(191) NOT NULL, \`enabled\` BOOLEAN NOT NULL DEFAULT false,
      \`betaMode\` BOOLEAN NOT NULL DEFAULT false, \`readOnly\` BOOLEAN NOT NULL DEFAULT false, \`scope\` VARCHAR(191) NOT NULL DEFAULT 'global',
      \`scopeId\` VARCHAR(191) NULL, \`config\` JSON NULL, \`description\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`FeatureFlag_name_key\` (\`name\`), INDEX \`FeatureFlag_scope_scopeId_enabled_idx\` (\`scope\`,\`scopeId\`,\`enabled\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        `CREATE TABLE IF NOT EXISTS \`WorkflowConfiguration\` (
      \`id\` VARCHAR(191) NOT NULL, \`type\` VARCHAR(191) NOT NULL, \`scopeId\` VARCHAR(191) NULL,
      \`requiresApproval\` BOOLEAN NOT NULL DEFAULT false, \`varianceThreshold\` DOUBLE NULL,
      \`negativeStockRule\` VARCHAR(191) NOT NULL DEFAULT 'BLOCK', \`fefoEnforced\` BOOLEAN NOT NULL DEFAULT true,
      \`expiryBlocking\` BOOLEAN NOT NULL DEFAULT false, \`photoRequired\` BOOLEAN NOT NULL DEFAULT false,
      \`config\` JSON NULL, \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`), UNIQUE INDEX \`WorkflowConfiguration_type_scopeId_key\` (\`type\`,\`scopeId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    ];
    for (const statement of tables)
        await db_js_1.prisma.$executeRawUnsafe(statement);
    await ensureIndex('User', 'User_status_email_idx', '\`status\`, \`email\`');
    await ensureIndex('Location', 'Location_code_branchId_status_idx', '\`code\`, \`branchId\`, \`status\`');
    await ensureIndex('AuditLog', 'AuditLog_correlationId_idx', '\`correlationId\`');
    await ensureIndex('AuditLog', 'AuditLog_createdAt_idx', '\`createdAt\`');
    await ensureIndex('ImportBatch', 'ImportBatch_status_idx', '\`status\`');
    await ensureIndex('ImportBatch', 'ImportBatch_branchId_fileHash_idx', '\`branchId\`, \`fileHash\`');
    for (const table of exports.OPERATIONAL_TENANT_TABLES) {
        await ensureTenantId(table);
    }
}
