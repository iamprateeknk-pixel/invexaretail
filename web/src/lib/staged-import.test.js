import assert from 'node:assert/strict';
import test from 'node:test';
import { canCommit, canReverse, commitProgress, failuresToCsv, isTerminal, parseImportCsv, stepForStatus } from './staged-import.js';

test('CSV headers are recognised by common aliases and values stay as text for server-side Decimal parsing', () => {
  const { rows, problems } = parseImportCsv('SKU,Lot,Qty,Branch,Bill Time\nA-1,L1,2.500,Basni,2026-09-01 10:00\nA-2,L2,3,Jaipur,\n');
  assert.deepEqual(problems, []);
  assert.deepEqual(rows[0], { itemCode: 'A-1', lotNo: 'L1', quantity: '2.500', branchName: 'Basni', transactionAt: '2026-09-01 10:00' });
  assert.deepEqual(rows[1], { itemCode: 'A-2', lotNo: 'L2', quantity: '3', branchName: 'Jaipur' }, 'empty cells are omitted, not sent as ""');
});

test('quoted fields keep their commas and escaped quotes; BOM and CRLF are tolerated', () => {
  const { rows } = parseImportCsv('﻿itemCode,quantity,branchName\r\n"A,1",1,"Store ""North"""\r\n');
  assert.equal(rows[0].itemCode, 'A,1');
  assert.equal(rows[0].branchName, 'Store "North"');
});

test('a file without the required columns explains what is missing instead of posting nothing silently', () => {
  assert.match(parseImportCsv('foo,bar\n1,2').problems.join(' '), /item code/i);
  assert.match(parseImportCsv('itemCode,foo\nA,1').problems.join(' '), /quantity/i);
  assert.deepEqual(parseImportCsv('').rows, []);
  assert.match(parseImportCsv('').problems[0], /empty/i);
});

test('the failure export is CSV a user can repair and re-upload, with quotes escaped', () => {
  const csv = failuresToCsv([{ rowNumber: 4, field: 'branchName', code: 'UNKNOWN_BRANCH', message: 'No branch "X"' }]);
  assert.equal(csv, 'row,field,code,message\r\n"4","branchName","UNKNOWN_BRANCH","No branch ""X"""');
});

test('every batch status maps to exactly one wizard step; progress never exceeds 100%', () => {
  const map = { DRAFT: 'validate', VALIDATED: 'confirm', QUEUED_FOR_COMMIT: 'progress', COMMITTING: 'progress', REVERSING: 'progress', COMMITTED: 'result', PARTIALLY_COMMITTED: 'result', FAILED: 'result', REVERSED: 'result' };
  for (const [status, step] of Object.entries(map)) assert.equal(stepForStatus(status), step, status);
  assert.equal(isTerminal('COMMITTING'), false);
  assert.equal(isTerminal('REVERSED'), true);
  assert.deepEqual(commitProgress({ totalRows: 200, checkpointRowNumber: 50 }), { done: 50, total: 200, percent: 25 });
  assert.equal(commitProgress({ totalRows: 10, checkpointRowNumber: 99 }).percent, 100);
  assert.equal(commitProgress(null).percent, 0);
});

test('the per-type policy gates commit: opening stock is all-or-nothing, others allow partial success', () => {
  assert.equal(canCommit({ status: 'DRAFT', validRows: 5 }, 'PURCHASE').ok, false);
  assert.equal(canCommit({ status: 'VALIDATED', validRows: 0, invalidRows: 3 }, 'PURCHASE').ok, false);
  assert.equal(canCommit({ status: 'VALIDATED', validRows: 4, invalidRows: 1 }, 'PURCHASE').ok, true);
  const blocked = canCommit({ status: 'VALIDATED', validRows: 4, invalidRows: 1 }, 'OPENING_STOCK');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /all-or-nothing/i);
  assert.equal(canCommit({ status: 'VALIDATED', validRows: 4, invalidRows: 0 }, 'OPENING_STOCK').ok, true);
});

test('only a committed batch can be reversed', () => {
  assert.equal(canReverse({ status: 'COMMITTED' }), true);
  assert.equal(canReverse({ status: 'PARTIALLY_COMMITTED' }), true);
  for (const status of ['DRAFT', 'VALIDATED', 'COMMITTING', 'REVERSED', 'FAILED']) assert.equal(canReverse({ status }), false, status);
  assert.equal(canReverse(null), false);
});
