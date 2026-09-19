import { prisma } from './db.js';
import { ensureFoundationSchema } from './foundation-schema.js';

let schemaPromise: Promise<void> | undefined;

/**
 * Hostinger shared hosting does not expose a reliable release command. Keep
 * the additive daily-sync schema self-healing without altering or deleting
 * existing rows. Foreign keys are intentionally omitted for compatibility
 * with restricted MySQL accounts; Prisma still enforces model relations.
 */
export function ensureDailySyncSchema(): Promise<void> {
  schemaPromise ??= (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ImportBatch\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`type\` VARCHAR(191) NOT NULL,
      \`fileName\` VARCHAR(191) NOT NULL,
      \`sourceFormat\` VARCHAR(191) NOT NULL,
      \`importedById\` VARCHAR(191) NOT NULL,
      \`importedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`totalRows\` INTEGER NOT NULL,
      \`validRows\` INTEGER NOT NULL,
      \`invalidRows\` INTEGER NOT NULL,
      \`duplicateRows\` INTEGER NOT NULL DEFAULT 0,
      \`metadata\` JSON NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`ImportBatch_type_importedAt_idx\` (\`type\`, \`importedAt\`),
      INDEX \`ImportBatch_importedById_importedAt_idx\` (\`importedById\`, \`importedAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`InventoryMovement\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`dedupeKey\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`lotId\` VARCHAR(191) NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`movementType\` VARCHAR(191) NOT NULL,
      \`qtyDelta\` DOUBLE NOT NULL,
      \`transactionAt\` DATETIME(3) NOT NULL,
      \`importedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`sourceType\` VARCHAR(191) NOT NULL,
      \`sourceReference\` VARCHAR(191) NOT NULL,
      \`importBatchId\` VARCHAR(191) NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`metadata\` JSON NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`InventoryMovement_dedupeKey_key\` (\`dedupeKey\`),
      INDEX \`InventoryMovement_locationId_transactionAt_idx\` (\`locationId\`, \`transactionAt\`),
      INDEX \`InventoryMovement_itemId_locationId_transactionAt_idx\` (\`itemId\`, \`locationId\`, \`transactionAt\`),
      INDEX \`InventoryMovement_sourceType_sourceReference_idx\` (\`sourceType\`, \`sourceReference\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`SyncCheckpoint\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`sourceType\` VARCHAR(191) NOT NULL,
      \`syncedThroughAt\` DATETIME(3) NOT NULL,
      \`lastImportBatchId\` VARCHAR(191) NULL,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`SyncCheckpoint_locationId_sourceType_key\` (\`locationId\`, \`sourceType\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`OpeningStockSnapshot\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`importBatchId\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`lotId\` VARCHAR(191) NOT NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`qty\` DOUBLE NOT NULL,
      \`snapshotAt\` DATETIME(3) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`OpeningStockSnapshot_importBatchId_itemId_lotId_locationId_key\` (\`importBatchId\`, \`itemId\`, \`lotId\`, \`locationId\`),
      INDEX \`OpeningStockSnapshot_locationId_snapshotAt_idx\` (\`locationId\`, \`snapshotAt\`),
      INDEX \`OpeningStockSnapshot_itemId_locationId_idx\` (\`itemId\`, \`locationId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Reorder rules are requested while every location-scoped stock screen is
    // loading. Older Hostinger databases predate this table, which turns an
    // otherwise healthy stock response into a persistent "Module limited"
    // warning. Keep this additive and FK-free for restricted shared-hosting
    // MySQL users, matching the strategy used by the daily-sync tables above.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ReorderRule\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`minQty\` INTEGER NOT NULL DEFAULT 0,
      \`targetQty\` INTEGER NOT NULL DEFAULT 0,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`ReorderRule_itemId_locationId_key\` (\`itemId\`, \`locationId\`),
      INDEX \`ReorderRule_locationId_idx\` (\`locationId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Quarantine/damaged quantity buckets (blueprint section 7.2). Additive
    // columns on an existing table, same ADD COLUMN IF NOT EXISTS pattern
    // used for TransferLine.shortageQty.
    await prisma.$executeRawUnsafe(`ALTER TABLE \`StockLedger\` ADD COLUMN IF NOT EXISTS \`quarantine\` DOUBLE NOT NULL DEFAULT 0`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`StockLedger\` ADD COLUMN IF NOT EXISTS \`damaged\` DOUBLE NOT NULL DEFAULT 0`);

    // Exception Inbox (blueprint Module H / section 18). FK-free for the
    // same restricted-MySQL reason as the tables above; Prisma still
    // enforces the model relations for databases provisioned via migrate.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ExceptionCase\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`type\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
      \`priority\` VARCHAR(191) NOT NULL DEFAULT 'MEDIUM',
      \`title\` VARCHAR(191) NOT NULL,
      \`description\` TEXT NULL,
      \`itemId\` VARCHAR(191) NULL,
      \`lotId\` VARCHAR(191) NULL,
      \`locationId\` VARCHAR(191) NULL,
      \`branchId\` VARCHAR(191) NULL,
      \`quantity\` DOUBLE NULL,
      \`valueAtRisk\` DOUBLE NULL,
      \`sourceDocument\` VARCHAR(191) NULL,
      \`sourceLineId\` VARCHAR(191) NULL,
      \`ownerId\` VARCHAR(191) NULL,
      \`reportedById\` VARCHAR(191) NOT NULL,
      \`dueAt\` DATETIME(3) NULL,
      \`disposition\` VARCHAR(191) NULL,
      \`resolutionNotes\` TEXT NULL,
      \`resolvedAt\` DATETIME(3) NULL,
      \`closedAt\` DATETIME(3) NULL,
      \`metadata\` JSON NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`ExceptionCase_status_priority_dueAt_idx\` (\`status\`, \`priority\`, \`dueAt\`),
      INDEX \`ExceptionCase_type_status_idx\` (\`type\`, \`status\`),
      INDEX \`ExceptionCase_ownerId_status_idx\` (\`ownerId\`, \`status\`),
      INDEX \`ExceptionCase_locationId_status_idx\` (\`locationId\`, \`status\`),
      INDEX \`ExceptionCase_sourceDocument_sourceLineId_idx\` (\`sourceDocument\`, \`sourceLineId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Bin directory + putaway tasks (blueprint Module B / sections 6 & 8.3).
    // FK-free for the same restricted-MySQL reason as the tables above.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`Bin\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`code\` VARCHAR(191) NOT NULL,
      \`zone\` VARCHAR(191) NULL,
      \`aisle\` VARCHAR(191) NULL,
      \`rack\` VARCHAR(191) NULL,
      \`shelf\` VARCHAR(191) NULL,
      \`capacity\` DOUBLE NULL,
      \`storageClass\` VARCHAR(191) NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`Bin_locationId_code_key\` (\`locationId\`, \`code\`),
      INDEX \`Bin_locationId_status_idx\` (\`locationId\`, \`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`PutawayTask\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`lotId\` VARCHAR(191) NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`quantity\` DOUBLE NOT NULL,
      \`suggestedBinId\` VARCHAR(191) NULL,
      \`confirmedBinId\` VARCHAR(191) NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
      \`sourceDocument\` VARCHAR(191) NULL,
      \`sourceLineId\` VARCHAR(191) NULL,
      \`assignedToId\` VARCHAR(191) NULL,
      \`confirmedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`PutawayTask_locationId_status_idx\` (\`locationId\`, \`status\`),
      INDEX \`PutawayTask_status_idx\` (\`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Pick waves (blueprint Module C / section 9.2). FK-free for the same
    // restricted-MySQL reason as the tables above.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`PickWave\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
      \`transferIds\` JSON NOT NULL,
      \`assignedToId\` VARCHAR(191) NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`startedAt\` DATETIME(3) NULL,
      \`completedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`PickWave_locationId_status_idx\` (\`locationId\`, \`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // OMS orders + ATP starter (blueprint Module G / section 13.3). FK-free
    // for the same restricted-MySQL reason as the tables above. `Order` is
    // a MySQL reserved word but valid as a backtick-quoted table name.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`Order\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`channel\` VARCHAR(191) NOT NULL,
      \`externalReference\` VARCHAR(191) NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
      \`fulfillmentLocationId\` VARCHAR(191) NOT NULL,
      \`customerName\` VARCHAR(191) NULL,
      \`notes\` TEXT NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`reservedAt\` DATETIME(3) NULL,
      \`fulfilledAt\` DATETIME(3) NULL,
      \`cancelledAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`Order_status_createdAt_idx\` (\`status\`, \`createdAt\`),
      INDEX \`Order_channel_status_idx\` (\`channel\`, \`status\`),
      INDEX \`Order_fulfillmentLocationId_status_idx\` (\`fulfillmentLocationId\`, \`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    // Additive columns for databases that already had Order from a prior
    // deploy before reservation expiry was added.
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Order\` ADD COLUMN IF NOT EXISTS \`reservationExpiresAt\` DATETIME(3) NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Order\` ADD COLUMN IF NOT EXISTS \`expiredAt\` DATETIME(3) NULL`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`OrderLine\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`orderId\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`lotId\` VARCHAR(191) NULL,
      \`requestedQty\` DOUBLE NOT NULL,
      \`fulfilledQty\` DOUBLE NOT NULL DEFAULT 0,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`OrderLine_orderId_idx\` (\`orderId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Count tolerance rules (blueprint Module D / section 10.2). FK-free
    // for the same restricted-MySQL reason as the tables above.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ToleranceRule\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`label\` VARCHAR(191) NOT NULL,
      \`category\` VARCHAR(191) NULL,
      \`branchId\` VARCHAR(191) NULL,
      \`valueThreshold\` DOUBLE NULL,
      \`percentThreshold\` DOUBLE NULL,
      \`active\` BOOLEAN NOT NULL DEFAULT true,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`ToleranceRule_active_category_idx\` (\`active\`, \`category\`),
      INDEX \`ToleranceRule_branchId_active_idx\` (\`branchId\`, \`active\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Approval rules + requests (blueprint section 16.2). FK-free for the
    // same restricted-MySQL reason as the tables above.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ApprovalRule\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`label\` VARCHAR(191) NOT NULL,
      \`triggerType\` VARCHAR(191) NOT NULL,
      \`category\` VARCHAR(191) NULL,
      \`branchId\` VARCHAR(191) NULL,
      \`valueThreshold\` DOUBLE NOT NULL,
      \`requiredApproverRole\` VARCHAR(191) NOT NULL,
      \`active\` BOOLEAN NOT NULL DEFAULT true,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`ApprovalRule_triggerType_active_idx\` (\`triggerType\`, \`active\`),
      INDEX \`ApprovalRule_branchId_active_idx\` (\`branchId\`, \`active\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    // Additive column for databases that already had ApprovalRule from a
    // prior deploy before category scoping was added.
    await prisma.$executeRawUnsafe(`ALTER TABLE \`ApprovalRule\` ADD COLUMN IF NOT EXISTS \`category\` VARCHAR(191) NULL`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ApprovalRequest\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`ruleId\` VARCHAR(191) NOT NULL,
      \`triggerType\` VARCHAR(191) NOT NULL,
      \`entityType\` VARCHAR(191) NOT NULL,
      \`entityId\` VARCHAR(191) NOT NULL,
      \`valueAtStake\` DOUBLE NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
      \`requestedById\` VARCHAR(191) NOT NULL,
      \`decidedById\` VARCHAR(191) NULL,
      \`decidedAt\` DATETIME(3) NULL,
      \`decisionNotes\` TEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`ApprovalRequest_entityType_entityId_status_idx\` (\`entityType\`, \`entityId\`, \`status\`),
      INDEX \`ApprovalRequest_status_triggerType_idx\` (\`status\`, \`triggerType\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Evidence rules (blueprint section 16.2, "damaged receipt > threshold
    // -> photo mandatory"). FK-free for the same restricted-MySQL reason
    // as the tables above.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`EvidenceRule\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`label\` VARCHAR(191) NOT NULL,
      \`triggerType\` VARCHAR(191) NOT NULL,
      \`category\` VARCHAR(191) NULL,
      \`branchId\` VARCHAR(191) NULL,
      \`quantityThreshold\` DOUBLE NULL,
      \`valueThreshold\` DOUBLE NULL,
      \`active\` BOOLEAN NOT NULL DEFAULT true,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`EvidenceRule_triggerType_active_idx\` (\`triggerType\`, \`active\`),
      INDEX \`EvidenceRule_branchId_active_idx\` (\`branchId\`, \`active\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // QC checklist templates + inspections (blueprint §8.2). FK-free for
    // the same restricted-MySQL reason as the tables above.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`QcChecklistTemplate\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`label\` VARCHAR(191) NOT NULL,
      \`category\` VARCHAR(191) NULL,
      \`checks\` JSON NOT NULL,
      \`active\` BOOLEAN NOT NULL DEFAULT true,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`QcChecklistTemplate_active_category_idx\` (\`active\`, \`category\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`QcInspection\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`templateId\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NULL,
      \`lotId\` VARCHAR(191) NULL,
      \`locationId\` VARCHAR(191) NULL,
      \`sourceDocument\` VARCHAR(191) NULL,
      \`sourceLineId\` VARCHAR(191) NULL,
      \`results\` JSON NOT NULL,
      \`overallResult\` VARCHAR(191) NOT NULL,
      \`notes\` TEXT NULL,
      \`inspectedById\` VARCHAR(191) NOT NULL,
      \`exceptionCaseId\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`QcInspection_sourceDocument_sourceLineId_idx\` (\`sourceDocument\`, \`sourceLineId\`),
      INDEX \`QcInspection_overallResult_createdAt_idx\` (\`overallResult\`, \`createdAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Intelligence Action Center dismissals (blueprint §17.1). FK-free for
    // the same restricted-MySQL reason as the tables above.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`IntelligenceDismissal\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`locationId\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`type\` VARCHAR(191) NOT NULL,
      \`countId\` VARCHAR(191) NULL,
      \`reason\` VARCHAR(191) NULL,
      \`dismissedById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`IntelligenceDismissal_locationId_itemId_type_createdAt_idx\` (\`locationId\`, \`itemId\`, \`type\`, \`createdAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ControlPlaneState\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`payload\` JSON NOT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`ALTER TABLE \`Location\` ADD COLUMN IF NOT EXISTS \`latitude\` DOUBLE NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Location\` ADD COLUMN IF NOT EXISTS \`longitude\` DOUBLE NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Location\` ADD COLUMN IF NOT EXISTS \`deliverySlaHours\` DOUBLE NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Location\` ADD COLUMN IF NOT EXISTS \`shippingCostPerKm\` DOUBLE NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`OrderLine\` ADD COLUMN IF NOT EXISTS \`fulfillmentLocationId\` VARCHAR(191) NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`StockMovement\` ADD COLUMN IF NOT EXISTS \`binId\` VARCHAR(191) NULL`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`BinStock\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`lotId\` VARCHAR(191) NOT NULL DEFAULT '',
      \`locationId\` VARCHAR(191) NOT NULL,
      \`binId\` VARCHAR(191) NOT NULL,
      \`onHand\` DOUBLE NOT NULL DEFAULT 0,
      \`reserved\` DOUBLE NOT NULL DEFAULT 0,
      \`version\` INTEGER NOT NULL DEFAULT 0,
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`BinStock_itemId_lotId_locationId_binId_key\` (\`itemId\`, \`lotId\`, \`locationId\`, \`binId\`),
      INDEX \`BinStock_locationId_binId_idx\` (\`locationId\`, \`binId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`MarketplaceConnector\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`platform\` VARCHAR(191) NOT NULL,
      \`channel\` VARCHAR(191) NOT NULL,
      \`webhookSecret\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
      \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'default-company',
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`lastIngestedAt\` DATETIME(3) NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`MarketplaceConnector_tenantId_status_idx\` (\`tenantId\`, \`status\`),
      INDEX \`MarketplaceConnector_platform_status_idx\` (\`platform\`, \`status\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`SerialNumber\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`lotId\` VARCHAR(191) NULL,
      \`serial\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'IN_STOCK',
      \`currentLocationId\` VARCHAR(191) NULL,
      \`currentBinId\` VARCHAR(191) NULL,
      \`receivedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`soldAt\` DATETIME(3) NULL,
      \`returnState\` VARCHAR(191) NULL,
      \`warrantyEnd\` DATETIME(3) NULL,
      \`metadata\` JSON NULL,
      \`companyId\` VARCHAR(191) NOT NULL DEFAULT 'default-company',
      \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`SerialNumber_itemId_serial_key\` (\`itemId\`, \`serial\`),
      INDEX \`SerialNumber_currentLocationId_status_idx\` (\`currentLocationId\`, \`status\`),
      INDEX \`SerialNumber_companyId_idx\` (\`companyId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`SerialMovement\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`serialNumberId\` VARCHAR(191) NOT NULL,
      \`movementType\` VARCHAR(191) NOT NULL,
      \`fromLocationId\` VARCHAR(191) NULL,
      \`toLocationId\` VARCHAR(191) NULL,
      \`fromStatus\` VARCHAR(191) NULL,
      \`toStatus\` VARCHAR(191) NOT NULL,
      \`reference\` VARCHAR(191) NULL,
      \`actorId\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`SerialMovement_serialNumberId_createdAt_idx\` (\`serialNumberId\`, \`createdAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`BinMovement\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`lotId\` VARCHAR(191) NOT NULL DEFAULT '',
      \`locationId\` VARCHAR(191) NOT NULL,
      \`fromBinId\` VARCHAR(191) NOT NULL,
      \`toBinId\` VARCHAR(191) NOT NULL,
      \`quantity\` DOUBLE NOT NULL,
      \`reference\` VARCHAR(191) NULL,
      \`actorId\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`BinMovement_locationId_createdAt_idx\` (\`locationId\`, \`createdAt\`),
      INDEX \`BinMovement_itemId_idx\` (\`itemId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`ALTER TABLE \`Bin\` ADD COLUMN IF NOT EXISTS \`isPickFace\` BOOLEAN NOT NULL DEFAULT false`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Bin\` ADD COLUMN IF NOT EXISTS \`pickFaceMin\` DOUBLE NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Bin\` ADD COLUMN IF NOT EXISTS \`pickFaceMax\` DOUBLE NULL`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`PackSession\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`orderId\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'IN_PROGRESS',
      \`cartonCount\` INTEGER NULL,
      \`weightKg\` DOUBLE NULL,
      \`lengthCm\` DOUBLE NULL,
      \`widthCm\` DOUBLE NULL,
      \`heightCm\` DOUBLE NULL,
      \`packedById\` VARCHAR(191) NOT NULL,
      \`sealedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL DEFAULT 'default-company',
      \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
      PRIMARY KEY (\`id\`),
      INDEX \`PackSession_orderId_status_idx\` (\`orderId\`, \`status\`),
      INDEX \`PackSession_companyId_idx\` (\`companyId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`PackedLine\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`packSessionId\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`lotId\` VARCHAR(191) NULL,
      \`quantity\` DOUBLE NOT NULL,
      \`scannedById\` VARCHAR(191) NOT NULL,
      \`scannedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`PackedLine_packSessionId_idx\` (\`packSessionId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`Shipment\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`orderId\` VARCHAR(191) NOT NULL,
      \`packSessionId\` VARCHAR(191) NULL,
      \`carrierProvider\` VARCHAR(191) NOT NULL,
      \`awbNumber\` VARCHAR(191) NOT NULL,
      \`serviceCode\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'BOOKED',
      \`labelUrl\` VARCHAR(191) NULL,
      \`manifestId\` VARCHAR(191) NULL,
      \`weightKg\` DOUBLE NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL DEFAULT 'default-company',
      \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`Shipment_awbNumber_key\` (\`awbNumber\`),
      INDEX \`Shipment_orderId_idx\` (\`orderId\`),
      INDEX \`Shipment_companyId_idx\` (\`companyId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`ALTER TABLE \`Order\` ADD COLUMN IF NOT EXISTS \`estimatedDispatchAt\` DATETIME(3) NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Order\` ADD COLUMN IF NOT EXISTS \`estimatedDeliveryAt\` DATETIME(3) NULL`);

    await prisma.$executeRawUnsafe(`ALTER TABLE \`WebhookDeliveryLog\` ADD COLUMN IF NOT EXISTS \`payloadHash\` VARCHAR(191) NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`WebhookDeliveryLog\` ADD COLUMN IF NOT EXISTS \`nextRetryAt\` DATETIME(3) NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`WebhookDeliveryLog\` ADD COLUMN IF NOT EXISTS \`body\` TEXT NULL`);

    await prisma.$executeRawUnsafe(`ALTER TABLE \`PurchaseOrder\` ADD COLUMN IF NOT EXISTS \`freightCost\` DOUBLE NULL DEFAULT 0`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`PurchaseOrder\` ADD COLUMN IF NOT EXISTS \`customsCost\` DOUBLE NULL DEFAULT 0`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`PurchaseOrder\` ADD COLUMN IF NOT EXISTS \`insuranceCost\` DOUBLE NULL DEFAULT 0`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`PurchaseOrder\` ADD COLUMN IF NOT EXISTS \`handlingCost\` DOUBLE NULL DEFAULT 0`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`PurchaseOrder\` ADD COLUMN IF NOT EXISTS \`landedCostMethod\` VARCHAR(191) NULL DEFAULT 'VALUE'`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`SupplierInvoice\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`purchaseOrderId\` VARCHAR(191) NOT NULL,
      \`invoiceNumber\` VARCHAR(191) NOT NULL,
      \`invoiceDate\` DATETIME(3) NULL,
      \`totalAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
      \`matchResult\` JSON NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
      PRIMARY KEY (\`id\`),
      INDEX \`SupplierInvoice_purchaseOrderId_idx\` (\`purchaseOrderId\`),
      INDEX \`SupplierInvoice_tenantId_idx\` (\`tenantId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`SupplierInvoiceLine\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`supplierInvoiceId\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`invoicedQty\` DOUBLE NOT NULL,
      \`unitCost\` DOUBLE NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`SupplierInvoiceLine_supplierInvoiceId_idx\` (\`supplierInvoiceId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`PriceList\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`priceType\` VARCHAR(191) NOT NULL,
      \`branchId\` VARCHAR(191) NULL,
      \`customerGroup\` VARCHAR(191) NULL,
      \`price\` DOUBLE NOT NULL,
      \`effectiveFrom\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`effectiveTo\` DATETIME(3) NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL DEFAULT 'default-company',
      \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
      PRIMARY KEY (\`id\`),
      INDEX \`PriceList_itemId_priceType_branchId_idx\` (\`itemId\`, \`priceType\`, \`branchId\`),
      INDEX \`PriceList_companyId_idx\` (\`companyId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`SavedView\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`ownerId\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`entityType\` VARCHAR(191) NOT NULL DEFAULT 'ITEM',
      \`filter\` JSON NOT NULL,
      \`isShared\` BOOLEAN NOT NULL DEFAULT false,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL DEFAULT 'default-company',
      \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
      PRIMARY KEY (\`id\`),
      INDEX \`SavedView_ownerId_updatedAt_idx\` (\`ownerId\`, \`updatedAt\`),
      INDEX \`SavedView_isShared_updatedAt_idx\` (\`isShared\`, \`updatedAt\`),
      INDEX \`SavedView_companyId_idx\` (\`companyId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ReturnRequest\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`orderId\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
      \`reason\` VARCHAR(191) NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL DEFAULT 'default-company',
      \`tenantId\` VARCHAR(191) NOT NULL DEFAULT 'tenant-invexa',
      PRIMARY KEY (\`id\`),
      INDEX \`ReturnRequest_orderId_status_idx\` (\`orderId\`, \`status\`),
      INDEX \`ReturnRequest_companyId_idx\` (\`companyId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`ReturnLine\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`returnRequestId\` VARCHAR(191) NOT NULL,
      \`orderLineId\` VARCHAR(191) NOT NULL,
      \`itemId\` VARCHAR(191) NOT NULL,
      \`quantity\` DOUBLE NOT NULL,
      \`disposition\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`ReturnLine_returnRequestId_idx\` (\`returnRequestId\`),
      INDEX \`ReturnLine_orderLineId_idx\` (\`orderLineId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Durable invalidation journal: survives process restarts and is readable
    // by every API replica. SSE uses this table as its replay cursor source.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`DomainEventOutbox\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`topic\` VARCHAR(191) NOT NULL,
      \`companyId\` VARCHAR(191) NOT NULL,
      \`locationIds\` JSON NULL,
      \`actorId\` VARCHAR(191) NULL,
      \`requestId\` VARCHAR(191) NULL,
      \`occurredAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`DomainEventOutbox_companyId_id_idx\` (\`companyId\`, \`id\`),
      INDEX \`DomainEventOutbox_occurredAt_idx\` (\`occurredAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await ensureFoundationSchema();
  })().catch((error) => {
    schemaPromise = undefined;
    throw error;
  });
  return schemaPromise;
}
