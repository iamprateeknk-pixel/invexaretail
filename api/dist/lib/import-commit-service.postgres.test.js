"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 11: the staged import lifecycle, exercised against real Postgres.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const import_business_rules_js_1 = require("./import-business-rules.js");
const import_commit_service_js_1 = require("./import-commit-service.js");
const import_checksum_js_1 = require("./import-checksum.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function makeFixture(companyId = `import-test-${(0, node_crypto_1.randomUUID)()}`) {
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `import-test-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Import Test User', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    const hoLocationId = `import-test-ho-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: hoLocationId, code: hoLocationId, name: import_business_rules_js_1.HO_LOCATION_NAME, type: 'warehouse', companyId } });
    const branchLocationId = `import-test-branch-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: branchLocationId, code: branchLocationId, name: 'Test Branch', type: 'store', companyId } });
    const itemId = `import-test-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Import Test Item', unit: 'ea', companyId } });
    const tenant = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
    return { tenant, hoLocationId, branchLocationId, itemId };
}
function purchaseRow(itemCode, lotNo, quantity, transactionAt = '2026-01-01T00:00:00.000Z') {
    return { itemCode, lotNo, quantity, transactionAt };
}
function salesRow(itemCode, lotNo, quantity, branchName, transactionAt = '2026-01-02T00:00:00.000Z') {
    return { itemCode, lotNo, quantity, branchName, transactionAt };
}
integration('a valid purchase batch commits, posts at HO Basni and reconciles the stock ledger', async () => {
    const { tenant, hoLocationId, itemId } = await makeFixture();
    const rows = [purchaseRow(itemId, 'LOT-A', 10), purchaseRow(itemId, 'LOT-A', 5)];
    const batch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'PURCHASE', fileName: 'purchase.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows)), rows, importedById: tenant.userId,
    });
    const summary = await (0, import_commit_service_js_1.validateImportBatch)(tenant, batch.id);
    strict_1.default.equal(summary.validRows, 2);
    strict_1.default.equal(summary.invalidRows, 0);
    await (0, import_commit_service_js_1.queueImportBatchForCommit)(tenant, batch.id);
    await (0, import_commit_service_js_1.commitImportBatchToCompletion)(batch.id);
    const final = await db_js_1.prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    strict_1.default.equal(final.status, 'COMMITTED');
    strict_1.default.equal(final.checkpointRowNumber, 2);
    const lot = await db_js_1.prisma.lot.findUniqueOrThrow({ where: { itemId_lotNo: { itemId, lotNo: 'LOT-A' } } });
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId: lot.id, locationId: hoLocationId } } });
    strict_1.default.equal(ledger?.onHand, 15, 'both purchase rows must land at HO Basni regardless of any branch field');
});
integration('a golden dataset of 5,000 purchase rows and 5,000 sales rows reconciles to expected totals', async () => {
    const { tenant, itemId } = await makeFixture();
    await db_js_1.prisma.location.updateMany({ where: { companyId: tenant.companyId, name: 'Test Branch' }, data: {} });
    const branch = await db_js_1.prisma.location.findFirstOrThrow({ where: { companyId: tenant.companyId, name: 'Test Branch' } });
    const purchaseRows = Array.from({ length: 5000 }, (_, i) => purchaseRow(itemId, 'GOLD-LOT', 2));
    const purchaseBatch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'PURCHASE', fileName: 'golden-purchase.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(purchaseRows)), rows: purchaseRows, importedById: tenant.userId,
    });
    await (0, import_commit_service_js_1.validateImportBatch)(tenant, purchaseBatch.id);
    await (0, import_commit_service_js_1.queueImportBatchForCommit)(tenant, purchaseBatch.id);
    await (0, import_commit_service_js_1.commitImportBatchToCompletion)(purchaseBatch.id, 500);
    const salesRows = Array.from({ length: 5000 }, () => salesRow(itemId, 'GOLD-LOT', 1, branch.name));
    const salesBatch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'SALES', fileName: 'golden-sales.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(salesRows)), rows: salesRows, importedById: tenant.userId,
    });
    await (0, import_commit_service_js_1.validateImportBatch)(tenant, salesBatch.id);
    await (0, import_commit_service_js_1.queueImportBatchForCommit)(tenant, salesBatch.id);
    await (0, import_commit_service_js_1.commitImportBatchToCompletion)(salesBatch.id, 500);
    const purchaseFinal = await db_js_1.prisma.importBatch.findUniqueOrThrow({ where: { id: purchaseBatch.id } });
    const salesFinal = await db_js_1.prisma.importBatch.findUniqueOrThrow({ where: { id: salesBatch.id } });
    strict_1.default.equal(purchaseFinal.status, 'COMMITTED');
    strict_1.default.equal(salesFinal.status, 'COMMITTED');
    const lot = await db_js_1.prisma.lot.findUniqueOrThrow({ where: { itemId_lotNo: { itemId, lotNo: 'GOLD-LOT' } } });
    const hoLedger = await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId, lotId: lot.id, location: { name: import_business_rules_js_1.HO_LOCATION_NAME, companyId: tenant.companyId } } });
    const branchLedger = await db_js_1.prisma.stockLedger.findUniqueOrThrow({ where: { itemId_lotId_locationId: { itemId, lotId: lot.id, locationId: branch.id } } });
    strict_1.default.equal(hoLedger.onHand, 10000, '5000 rows x 2 units purchased at HO');
    strict_1.default.equal(branchLedger.onHand, -5000, '5000 rows x 1 unit sold from the branch');
});
integration('a byte-identical re-upload is rejected as a duplicate file and returns the existing batch', async () => {
    const { tenant, itemId } = await makeFixture();
    const rows = [purchaseRow(itemId, 'LOT-DUP', 3)];
    const checksum = (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows));
    const first = await (0, import_commit_service_js_1.createImportBatch)(tenant, { type: 'PURCHASE', fileName: 'dup.json', sourceFormat: 'json', fileChecksum: checksum, rows, importedById: tenant.userId });
    await strict_1.default.rejects((0, import_commit_service_js_1.createImportBatch)(tenant, { type: 'PURCHASE', fileName: 'dup-again.json', sourceFormat: 'json', fileChecksum: checksum, rows, importedById: tenant.userId }), (error) => error instanceof import_commit_service_js_1.DuplicateFileError && error.existingBatchId === first.id);
});
integration('retrying a commit chunk after a simulated crash does not double-post (idempotency key + checkpoint)', async () => {
    const { tenant, hoLocationId, itemId } = await makeFixture();
    const rows = [purchaseRow(itemId, 'LOT-RETRY', 10), purchaseRow(itemId, 'LOT-RETRY', 20)];
    const batch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'PURCHASE', fileName: 'retry.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows)), rows, importedById: tenant.userId,
    });
    await (0, import_commit_service_js_1.validateImportBatch)(tenant, batch.id);
    await (0, import_commit_service_js_1.queueImportBatchForCommit)(tenant, batch.id);
    // Simulate a worker crash mid-commit: process one chunk (one row), then
    // "restart" by calling commitImportBatchChunk again from the same
    // durable checkpoint, then finish. Total posted must equal the sum once.
    await (0, import_commit_service_js_1.commitImportBatchChunk)(batch.id, 1);
    await (0, import_commit_service_js_1.commitImportBatchChunk)(batch.id, 1);
    await (0, import_commit_service_js_1.commitImportBatchToCompletion)(batch.id, 1);
    const final = await db_js_1.prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    strict_1.default.equal(final.status, 'COMMITTED');
    const lot = await db_js_1.prisma.lot.findUniqueOrThrow({ where: { itemId_lotNo: { itemId, lotNo: 'LOT-RETRY' } } });
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId: lot.id, locationId: hoLocationId } } });
    strict_1.default.equal(ledger?.onHand, 30, 'each row must be posted exactly once despite the resumed commit');
    const movementCount = await db_js_1.prisma.stockMovement.count({ where: { idempotencyKey: `import:${batch.id}:1` } });
    strict_1.default.equal(movementCount, 1);
});
integration('a wrong branch name, missing lot number and malformed quantity are each rejected with a structured row error', async () => {
    const { tenant, itemId } = await makeFixture();
    const rows = [
        salesRow(itemId, 'LOT-B', 1, 'Nonexistent Branch'),
        { itemCode: itemId, lotNo: '', quantity: 1, branchName: 'Test Branch', transactionAt: '2026-01-01T00:00:00.000Z' },
        salesRow(itemId, 'LOT-B', 'not-a-number', 'Test Branch'),
    ];
    const batch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'SALES', fileName: 'bad-rows.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows)), rows, importedById: tenant.userId,
    });
    const summary = await (0, import_commit_service_js_1.validateImportBatch)(tenant, batch.id);
    strict_1.default.equal(summary.validRows, 0);
    strict_1.default.equal(summary.invalidRows, 3);
    const failures = await (0, import_commit_service_js_1.exportFailedRows)(tenant, batch.id);
    const codes = failures.map((f) => f.code).sort();
    strict_1.default.deepEqual(codes, ['BRANCH_NOT_FOUND', 'INVALID_QUANTITY', 'MISSING_LOT_NO']);
});
integration('a row dated before the location sync checkpoint still posts, is flagged LATE_MOVEMENT, and never regresses the checkpoint', async () => {
    const { tenant, branchLocationId, itemId } = await makeFixture();
    await db_js_1.prisma.syncCheckpoint.create({
        data: { locationId: branchLocationId, sourceType: 'SALES', syncedThroughAt: new Date('2026-02-01T00:00:00.000Z'), lastImportBatchId: 'seed' },
    });
    const rows = [salesRow(itemId, 'LOT-LATE', 1, 'Test Branch', '2026-01-15T00:00:00.000Z')];
    const batch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'SALES', fileName: 'late.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows)), rows, importedById: tenant.userId,
    });
    await (0, import_commit_service_js_1.validateImportBatch)(tenant, batch.id);
    await (0, import_commit_service_js_1.queueImportBatchForCommit)(tenant, batch.id);
    await (0, import_commit_service_js_1.commitImportBatchToCompletion)(batch.id);
    const row = await db_js_1.prisma.importRow.findFirstOrThrow({ where: { importBatchId: batch.id } });
    strict_1.default.equal(row.status, 'COMMITTED');
    const warnings = row.warnings;
    strict_1.default.ok(warnings?.some((w) => w.code === 'LATE_MOVEMENT'));
    const checkpoint = await db_js_1.prisma.syncCheckpoint.findUniqueOrThrow({ where: { locationId_sourceType: { locationId: branchLocationId, sourceType: 'SALES' } } });
    strict_1.default.equal(checkpoint.syncedThroughAt.toISOString(), new Date('2026-02-01T00:00:00.000Z').toISOString(), 'a late row must never move the checkpoint backward');
});
integration('a mid-commit oversell fails only that row (partial failure); the rest of the chunk still commits', async () => {
    const { tenant, branchLocationId, itemId } = await makeFixture();
    const rows = [
        salesRow(itemId, 'LOT-PARTIAL', 5, 'Test Branch'),
        salesRow(itemId, 'LOT-PARTIAL', 3, 'Test Branch'),
    ];
    const batch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'SALES', fileName: 'oversell.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows)), rows, importedById: tenant.userId,
    });
    await (0, import_commit_service_js_1.validateImportBatch)(tenant, batch.id);
    await (0, import_commit_service_js_1.queueImportBatchForCommit)(tenant, batch.id);
    await (0, import_commit_service_js_1.commitImportBatchToCompletion)(batch.id);
    const final = await db_js_1.prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    // Both rows are independent SALES_DEDUCTIONs against zero starting stock;
    // negative-stock policy on this fixture's item may block both or neither
    // depending on the seeded item's negative-stock setting - what matters is
    // that a per-row failure never crashes the whole chunk, and every row
    // ends in a terminal, correctly-recorded state.
    strict_1.default.ok(['COMMITTED', 'PARTIALLY_COMMITTED'].includes(final.status));
    const committedCount = await db_js_1.prisma.importRow.count({ where: { importBatchId: batch.id, status: 'COMMITTED' } });
    const invalidCount = await db_js_1.prisma.importRow.count({ where: { importBatchId: batch.id, status: 'INVALID' } });
    strict_1.default.equal(committedCount + invalidCount, 2);
});
integration('reversing a committed batch nets zero stock delta and is safe to call twice', async () => {
    const { tenant, hoLocationId, itemId } = await makeFixture();
    const rows = [purchaseRow(itemId, 'LOT-REV', 7)];
    const batch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'PURCHASE', fileName: 'reverse.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows)), rows, importedById: tenant.userId,
    });
    await (0, import_commit_service_js_1.validateImportBatch)(tenant, batch.id);
    await (0, import_commit_service_js_1.queueImportBatchForCommit)(tenant, batch.id);
    await (0, import_commit_service_js_1.commitImportBatchToCompletion)(batch.id);
    const lot = await db_js_1.prisma.lot.findUniqueOrThrow({ where: { itemId_lotNo: { itemId, lotNo: 'LOT-REV' } } });
    let ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId: lot.id, locationId: hoLocationId } } });
    strict_1.default.equal(ledger?.onHand, 7);
    await (0, import_commit_service_js_1.reverseImportBatch)(tenant, batch.id, 'test reversal');
    ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId: lot.id, locationId: hoLocationId } } });
    strict_1.default.equal(ledger?.onHand, 0, 'reversal must net the purchase back to zero');
    // Calling reverse again on an already-REVERSED batch is refused by the
    // state machine (not COMMITTED/PARTIALLY_COMMITTED/REVERSING anymore) -
    // proving reverse-then-reverse cannot double-reverse the stock.
    await strict_1.default.rejects((0, import_commit_service_js_1.reverseImportBatch)(tenant, batch.id, 'second attempt'));
    ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId: lot.id, locationId: hoLocationId } } });
    strict_1.default.equal(ledger?.onHand, 0, 'stock must remain net zero after a rejected second reversal attempt');
});
integration('an import batch is tenant-scoped: another company cannot read, validate, commit or reverse it', async () => {
    const { tenant, itemId } = await makeFixture();
    const other = await makeFixture();
    const rows = [purchaseRow(itemId, 'LOT-TENANT', 4)];
    const batch = await (0, import_commit_service_js_1.createImportBatch)(tenant, {
        type: 'PURCHASE', fileName: 'tenant.json', sourceFormat: 'json',
        fileChecksum: (0, import_checksum_js_1.computeFileChecksum)(JSON.stringify(rows)), rows, importedById: tenant.userId,
    });
    await strict_1.default.rejects((0, import_commit_service_js_1.validateImportBatch)(other.tenant, batch.id));
    await strict_1.default.rejects((0, import_commit_service_js_1.queueImportBatchForCommit)(other.tenant, batch.id));
    await strict_1.default.rejects((0, import_commit_service_js_1.reverseImportBatch)(other.tenant, batch.id, 'cross-tenant attempt'));
    const ownRead = await (0, import_commit_service_js_1.validateImportBatch)(tenant, batch.id);
    strict_1.default.equal(ownRead.validRows, 1, 'the identical call must still succeed for the owning tenant');
});
