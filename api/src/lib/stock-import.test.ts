import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateOpeningStock, parseStockImport } from './stock-import.js';

function csvBuffer(rows: unknown[][]): Buffer {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\n'));
}

test('parses Invexa expiry stock reports with a title row and generated stable item codes', async () => {
  const rows = [
    ['EXPIRY STOCK From 11/09/2026 to 11/09/2026'],
    ['SNO.', 'BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'PACK/SIZE', 'BATCH', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK', 'CLOSING VALUE(PUR RATE)', 'CLOSING VALUE(SALE RATE)'],
    [1, 'Main Store', 'ALPINO', 'MUESLI 400GM', 'PCS', '1', 4994, '30/04/2027', 1.5, 300, 450],
    [2, 'Main Store', 'ALPINO', 'MUESLI 400GM', 'PCS', '1', 4994, '30/04/2027', -0.5, -100, -150],
    [null, null, 'GRAND TOTALS', null, null, null, null, null, 1, 200, 300],
  ];

  const parsed = await parseStockImport(csvBuffer(rows), 'stock.csv');
  assert.equal(parsed.format, 'invexa-expiry-stock');
  assert.equal(parsed.headerRow, 2);
  assert.equal(parsed.totalRows, 2);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.duplicateRows, 1);
  assert.equal(parsed.fractionalQuantityRows, 2);
  assert.equal(parsed.negativeQuantityRows, 1);
  assert.equal(parsed.validRows[0].lotNo, '4994');
  assert.match(parsed.validRows[0].code, /^ERP-[A-F0-9]{12}$/);
  assert.equal(parsed.validRows[0].expiryDate, '2027-04-30T00:00:00.000Z');
  assert.equal(aggregateOpeningStock(parsed.validRows)[0].quantity, 1);
});

test('keeps the same item in separate rows when lot codes differ', async () => {
  const rows = [
    ['BRANCH NAME', 'ITEM CODE', 'ITEM NAME', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
    ['Main Store', 'XYZ-001', 'xyz', '210', '31/01/2027', 2],
    ['Main Store', 'XYZ-001', 'xyz', '340', '28/02/2027', 4],
    ['Main Store', 'XYZ-001', 'xyz', '415', '31/03/2027', 2],
  ];
  const parsed = await parseStockImport(csvBuffer(rows), 'lot-stock.csv');
  const lots = aggregateOpeningStock(parsed.validRows);
  assert.equal(lots.length, 3);
  assert.equal(lots.reduce((total, row) => total + row.quantity, 0), 8);
  assert.deepEqual(lots.map((row) => row.lotNo), ['210', '340', '415']);
});

test('keeps the existing Code,Name,Category,Unit CSV format', async () => {
  const parsed = await parseStockImport(Buffer.from('Code,Name,Category,Unit\nRICE-001,"Premium, Rice",Grains,kg\n'), 'items.csv');
  assert.equal(parsed.format, 'standard-items');
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0].code, 'RICE-001');
  assert.equal(parsed.validRows[0].itemName, 'Premium, Rice');
  assert.equal(parsed.validRows[0].category, 'Grains');
});

test('maps the complete 14-column stock master format', async () => {
  const rows = [
    ['Inventory report'],
    ['SNO.', 'COMPANY NAME', 'BRANCH NAME', 'CATEGORY', 'SUB CATEGORY', 'ITEM CODE', 'ITEM NAME', 'PACK/SIZE', 'BATCH', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK', 'CLOSING VALUE(PUR RATE)', 'CLOSING VALUE(SALE RATE)'],
    [1, '4700 BC', 'Gopalpura', 'SIDE IMPULSE', 'POPCORN', 'Q5696', 'CARAMEL POPCORN', 'PCS', '1', '4916', '28/02/2027', 2, 64.5, 86],
  ];
  const parsed = await parseStockImport(csvBuffer(rows), 'full-stock.csv');
  assert.equal(parsed.validRows[0].code, 'Q5696');
  assert.equal(parsed.validRows[0].companyName, '4700 BC');
  assert.equal(parsed.validRows[0].category, 'SIDE IMPULSE');
  assert.equal(parsed.validRows[0].subcategory, 'POPCORN');
  assert.equal(parsed.validRows[0].locationName, 'Gopalpura');
  assert.equal(parsed.validRows[0].purchaseValue, 64.5);
  assert.equal(parsed.validRows[0].saleValue, 86);
});

test('isolates invalid rows without blocking valid rows', async () => {
  const rows = [
    ['BRANCH NAME', 'ITEM NAME', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
    ['Main Store', 'Valid Item', 'L1', '', 2],
    ['Main Store', 'Bad Date', 'L2', '31/02/2027', 3],
    ['', 'No Branch', 'L3', '', 4],
  ];
  const parsed = await parseStockImport(csvBuffer(rows), 'stock.csv');
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.errors.length, 2);
  assert.deepEqual(parsed.errors.map((error) => error.rowNumber), [3, 4]);
});

test('accepts a 6,000-row lot-wise stock upload for bulk updates', async () => {
  const rows: unknown[][] = [
    ['BRANCH NAME', 'ITEM CODE', 'ITEM NAME', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
    ...Array.from({ length: 6_000 }, (_, index) => [
      index % 2 === 0 ? 'Main Store' : 'H.O. Basni',
      `SKU-${String(index % 50).padStart(3, '0')}`,
      `Item ${index % 50}`,
      `LOT-${String(index).padStart(5, '0')}`,
      '31/12/2027',
      (index % 9) + 1,
    ]),
  ];
  const parsed = await parseStockImport(csvBuffer(rows), 'lot-wise-6000.csv');
  assert.equal(parsed.format, 'invexa-expiry-stock');
  assert.equal(parsed.totalRows, 6_000);
  assert.equal(parsed.validRows.length, 6_000);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.validRows.at(-1)?.lotNo, 'LOT-05999');
});
