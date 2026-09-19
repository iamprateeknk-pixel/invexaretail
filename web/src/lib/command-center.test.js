import assert from 'node:assert/strict';
import test from 'node:test';
import { ageLabel, attentionTarget, auditExportPath, heatClass, pulseBars } from './command-center.js';

test('import age reads in plain words', () => {
  assert.deepEqual([null, 0.4, 1, 5.4, 47, 72].map(ageLabel), ['never', 'under an hour', '1 hour', '5 hours', '47 hours', '3 days']);
});

test('the heatmap colours mean done, half done, started and untouched', () => {
  assert.deepEqual([null, 1, 0.5, 0.2, 0].map(heatClass), ['bg-muted', 'bg-emerald-500', 'bg-emerald-300', 'bg-amber-300', 'bg-red-300']);
});

test('pulse bars scale to the busiest day and an empty week stays flat', () => {
  const bars = pulseBars([{ day: 'a', countsSubmitted: 2 }, { day: 'b', countsSubmitted: 4 }, { day: 'c' }], 'countsSubmitted');
  assert.deepEqual(bars.map((bar) => bar.height), [50, 100, 0]);
  assert.deepEqual(pulseBars([{ day: 'a' }], 'x').map((bar) => bar.height), [0]);
});

test('deep links and the audit export path are built safely', () => {
  assert.equal(attentionTarget('transfers'), '#/transfers');
  assert.equal(auditExportPath(), '/api/v1/reports/audit-export');
  assert.equal(auditExportPath({ action: 'TRANSFER', from: '', entityType: 'Transfer' }), '/api/v1/reports/audit-export?action=TRANSFER&entityType=Transfer');
  assert.equal(auditExportPath({ actorId: 'a&b=c' }), '/api/v1/reports/audit-export?actorId=a%26b%3Dc');
});
