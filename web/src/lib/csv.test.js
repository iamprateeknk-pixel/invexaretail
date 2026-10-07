import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from './csv.js';

test('cells are quoted only when needed and quotes are doubled', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
});

test('formula-looking cells are neutralised so a spreadsheet cannot execute them', () => {
  for (const hostile of ['=HYPERLINK("http://evil","x")', '+SUM(A1)', '@cmd', '-2+3', '\tTAB']) {
    assert.ok(csvCell(hostile).replace(/^"/, '').startsWith("'"), `${hostile} must be prefixed`);
  }
  assert.equal(csvCell('-12.5'), '-12.5', 'a plain negative number is data, not a formula');
  assert.equal(csvCell(-3), '-3');
});

test('toCsv writes a header and one CRLF-separated line per row using the given columns', () => {
  const csv = toCsv([{ label: 'Item', value: (r) => r.name }, { label: 'Qty', value: (r) => r.qty }], [{ name: 'Rice, long', qty: 4 }, { name: 'Milk', qty: 0 }]);
  assert.equal(csv, 'Item,Qty\r\n"Rice, long",4\r\nMilk,0');
  assert.equal(toCsv([{ label: 'A', value: () => 1 }], []), 'A');
  assert.equal(toCsv([{ label: 'A', value: () => 1 }], undefined), 'A');
});
