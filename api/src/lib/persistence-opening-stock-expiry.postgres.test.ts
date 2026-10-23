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
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { parseStockImport } from './stock-import.js';
import { persistOpeningStockImport } from './persistence.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function csvBuffer(rows: unknown[][]): Buffer {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\n'));
}

integration('persistOpeningStockImport commits a lot with an expiry date without the 42804 timestamp/text CASE-WHEN error', async () => {
  const companyId = `persist-opening-expiry-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  // ImportBatch.importedById is a real FK; do not depend on a seeded 'user-admin-1' existing.
  const userId = `persist-opening-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Opening Expiry Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const branchName = `Expiry Test Branch ${randomUUID().slice(0, 8)}`;
  const itemCode = `EXP-${randomUUID().slice(0, 8)}`;
  const lotCode = `LOT-${randomUUID().slice(0, 8)}`;

  const rows = [
    ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'ITEM CODE', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
    [branchName, 'Test Co', 'Expiry Test Item', itemCode, lotCode, '31/01/2027', 5],
  ];
  const preview = await parseStockImport(csvBuffer(rows), 'stock.csv');
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.validRows.length, 1);
  assert.equal(preview.validRows[0].expiryDate, '2027-01-31T00:00:00.000Z');

  const result = await persistOpeningStockImport(preview, 'stock.csv', userId, { companyId });
  assert.equal(result.stockRows, 1);

  const item = await prisma.item.findFirst({ where: { code: itemCode, companyId } });
  assert.ok(item, 'the item must have been created');
  const lot = await prisma.lot.findFirst({ where: { itemId: item!.id, lotNo: lotCode } });
  assert.ok(lot, 'the lot must have been created');
  assert.ok(lot!.expiryDate, 'the lot must carry the expiry date from the import row');
  assert.equal(lot!.expiryDate!.toISOString().slice(0, 10), '2027-01-31');
});
