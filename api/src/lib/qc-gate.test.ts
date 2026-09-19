import test from 'node:test';
import assert from 'node:assert/strict';
import { quarantineFailedLines, verdictForLine } from './qc-gate.js';

test('the latest applicable inspection decides, and none means no verdict', () => {
  const inspections = [
    { itemId: 'a', sourceLineId: 'l1', overallResult: 'FAIL', createdAt: '2026-09-19T08:00:00Z' },
    { itemId: 'a', sourceLineId: 'l1', overallResult: 'PASS', createdAt: '2026-09-19T09:00:00Z' },
    { itemId: 'b', sourceLineId: null, results: { seal: 'FAIL' as const, label: 'PASS' as const } },
  ];
  assert.equal(verdictForLine(inspections, { itemId: 'a', lineId: 'l1' }), 'PASS', 're-inspection replaces the earlier failure');
  assert.equal(verdictForLine(inspections, { itemId: 'b', lineId: 'anything' }), 'FAIL', 'a whole-item inspection applies to any line; results are evaluated when there is no overall');
  assert.equal(verdictForLine(inspections, { itemId: 'a', lineId: 'other-line' }), null, 'an inspection of another line does not count');
  assert.equal(verdictForLine(inspections, { itemId: 'zzz' }), null);
});

test('a failed inspection moves the received quantity to quarantine without changing the totals', () => {
  const lines = [
    { itemId: 'a', lotId: 'l1', lineId: 'x', receivedQty: 6, damagedQty: 1 },
    { itemId: 'b', lotId: 'l2', lineId: 'y', receivedQty: 4, damagedQty: 0 },
    { itemId: 'c', lotId: 'l3', lineId: 'z', receivedQty: 0, damagedQty: 2 },
  ];
  const verdicts: Record<string, 'PASS' | 'FAIL' | null> = { a: 'FAIL', b: 'PASS', c: 'FAIL' };
  const result = quarantineFailedLines(lines, (line) => verdicts[line.itemId]);
  assert.deepEqual(result.lines.map((line) => [line.itemId, line.receivedQty, line.damagedQty]), [['a', 0, 7], ['b', 4, 0], ['c', 0, 2]]);
  assert.deepEqual(result.quarantined, [{ itemId: 'a', lotId: 'l1', quantity: 6 }]);
  assert.equal(lines[0].receivedQty, 6, 'the input is not mutated');
});
