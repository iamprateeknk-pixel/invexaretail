import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStockImport } from '../lib/stock-import.js';
import { planStockUpdate } from './core.js';

function csvBuffer(rows: unknown[][]): Buffer {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\n'));
}

test('SET stock import prepares missing item, branch and separate lot rows for upsert', async () => {
  const rows = [
    ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
    ['DRY FRUIT FARM TEST', 'TEST COMPANY', 'UNIQUE IMPORT ITEM', '210', '31/01/2027', 2],
    ['DRY FRUIT FARM TEST', 'TEST COMPANY', 'UNIQUE IMPORT ITEM', '340', '28/02/2027', 4],
    ['DRY FRUIT FARM TEST', 'TEST COMPANY', 'UNIQUE IMPORT ITEM', '415', '31/03/2027', 2],
  ];
  const preview = await parseStockImport(csvBuffer(rows), 'stock.csv');
  const plan = planStockUpdate(preview, 'SET');

  assert.equal(plan.errors.length, 0);
  assert.equal(plan.prepared.length, 3);
  assert.equal(plan.newItems, 1);
  assert.equal(plan.newLocations, 1);
  assert.equal(new Set(plan.prepared.map((entry) => entry.lotId)).size, 3);
  assert.equal(plan.prepared.reduce((total, entry) => total + entry.resultingQty, 0), 8);
});

test('SET stock import accepts a negative closing-stock balance from the source ERP export', async () => {
  const rows = [
    ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
    ['DRY FRUIT FARM TEST', 'TEST COMPANY', 'NEGATIVE LOT ITEM', '999', '31/01/2027', -0.255],
  ];
  const preview = await parseStockImport(csvBuffer(rows), 'stock.csv');
  const plan = planStockUpdate(preview, 'SET');

  assert.equal(plan.errors.length, 0);
  assert.equal(plan.prepared.length, 1);
  assert.equal(plan.prepared[0].resultingQty, -0.255);
});

test('ADD/REMOVE stock import still rejects a non-positive quantity on an existing item', async () => {
  const rows = [
    ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'LOT CODE', 'CLOSING STOCK'],
    ['Main Store', 'TEST COMPANY', 'Rice 5kg', 'LOT-01', -1],
  ];
  const preview = await parseStockImport(csvBuffer(rows), 'stock.csv');
  const addPlan = planStockUpdate(preview, 'ADD');
  const removePlan = planStockUpdate(preview, 'REMOVE');

  assert.match(addPlan.errors[0]?.message ?? '', /positive number/);
  assert.match(removePlan.errors[0]?.message ?? '', /positive number/);
});

test('ADD stock import still rejects unknown item masters', async () => {
  const preview = await parseStockImport(csvBuffer([
    ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'LOT CODE', 'CLOSING STOCK'],
    ['UNKNOWN BRANCH FOR ADD', 'TEST COMPANY', 'UNKNOWN ITEM FOR ADD', 'L1', 1],
  ]), 'stock.csv');
  const plan = planStockUpdate(preview, 'ADD');

  assert.equal(plan.prepared.length, 0);
  assert.match(plan.errors[0]?.message ?? '', /Unknown item/);
});
