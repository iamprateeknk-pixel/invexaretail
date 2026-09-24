"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Fixes a real production bug surfaced during a bulk stock upload: opening
// stock rows carrying an expiry date failed with
// "Invalid `prisma.$executeRaw()` invocation: ... column "expiryDate" is of
// type timestamp without time zone but expression is of type text" (Postgres
// error 42804). persistOpeningStockImport's batched CASE-WHEN raw update
// (lib/persistence.ts) bound each Date parameter with no explicit type, so
// Postgres could not infer the CASE expression's result type from the
// parameterized values alone. Fixed by casting each THEN value to
// ::timestamp, matching the column's real type. DB-only - skipped unless
// TEST_DATABASE_URL is set, per AGENTS.md's rule that any change to
// lib/persistence.ts must be exercised against real Postgres.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const stock_import_js_1 = require("./stock-import.js");
const persistence_js_1 = require("./persistence.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
function csvBuffer(rows) {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\n'));
}
integration('persistOpeningStockImport commits a lot with an expiry date without the 42804 timestamp/text CASE-WHEN error', async () => {
    const companyId = `persist-opening-expiry-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const branchName = `Expiry Test Branch ${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    const itemCode = `EXP-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    const lotCode = `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    const rows = [
        ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'ITEM CODE', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
        [branchName, 'Test Co', 'Expiry Test Item', itemCode, lotCode, '31/01/2027', 5],
    ];
    const preview = await (0, stock_import_js_1.parseStockImport)(csvBuffer(rows), 'stock.csv');
    strict_1.default.equal(preview.errors.length, 0);
    strict_1.default.equal(preview.validRows.length, 1);
    strict_1.default.equal(preview.validRows[0].expiryDate, '2027-01-31T00:00:00.000Z');
    const result = await (0, persistence_js_1.persistOpeningStockImport)(preview, 'stock.csv', 'user-admin-1', { companyId });
    strict_1.default.equal(result.stockRows, 1);
    const item = await db_js_1.prisma.item.findFirst({ where: { code: itemCode, companyId } });
    strict_1.default.ok(item, 'the item must have been created');
    const lot = await db_js_1.prisma.lot.findFirst({ where: { itemId: item.id, lotNo: lotCode } });
    strict_1.default.ok(lot, 'the lot must have been created');
    strict_1.default.ok(lot.expiryDate, 'the lot must carry the expiry date from the import row');
    strict_1.default.equal(lot.expiryDate.toISOString().slice(0, 10), '2027-01-31');
});
