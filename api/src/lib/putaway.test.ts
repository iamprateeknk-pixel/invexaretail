import test from 'node:test';
import assert from 'node:assert/strict';
import { rankBinCandidates } from './putaway.js';

test('rankBinCandidates excludes a bin that would overflow its declared capacity', () => {
  const bins = [
    { id: 'full', capacity: 100, zone: 'A', pendingQty: 90 },
    { id: 'room', capacity: 100, zone: 'B', pendingQty: 10 },
  ];
  const winner = rankBinCandidates(bins, { incomingQty: 20, highVelocity: false });
  assert.equal(winner, 'room');
});

test('rankBinCandidates falls back to all candidates when every bin would overflow', () => {
  const bins = [
    { id: 'fuller', capacity: 100, zone: 'A', pendingQty: 95 },
    { id: 'less-full', capacity: 100, zone: 'B', pendingQty: 90 },
  ];
  const winner = rankBinCandidates(bins, { incomingQty: 20, highVelocity: false });
  assert.equal(winner, 'less-full');
});

test('rankBinCandidates prefers the least-utilized bin by capacity ratio, not raw pending quantity', () => {
  const bins = [
    { id: 'small-but-loaded', capacity: 10, zone: 'A', pendingQty: 8 },
    { id: 'large-with-room', capacity: 1000, zone: 'B', pendingQty: 50 },
  ];
  const winner = rankBinCandidates(bins, { incomingQty: 1, highVelocity: false });
  assert.equal(winner, 'large-with-room');
});

test('rankBinCandidates treats an empty unknown-capacity bin as available', () => {
  const bins = [
    { id: 'unknown-empty', capacity: null, zone: 'A', pendingQty: 0 },
    { id: 'known-half-full', capacity: 100, zone: 'B', pendingQty: 50 },
  ];
  const winner = rankBinCandidates(bins, { incomingQty: 1, highVelocity: false });
  assert.equal(winner, 'unknown-empty');
});

test('rankBinCandidates prioritizes zone over fullness for a high-velocity item', () => {
  const bins = [
    { id: 'near-zone-busier', capacity: 100, zone: 'A', pendingQty: 40 },
    { id: 'far-zone-emptier', capacity: 100, zone: 'Z', pendingQty: 0 },
  ];
  const winner = rankBinCandidates(bins, { incomingQty: 1, highVelocity: true });
  assert.equal(winner, 'near-zone-busier');
});

test('rankBinCandidates ignores zone for a normal-velocity item, ranking by fullness instead', () => {
  const bins = [
    { id: 'near-zone-busier', capacity: 100, zone: 'A', pendingQty: 40 },
    { id: 'far-zone-emptier', capacity: 100, zone: 'Z', pendingQty: 0 },
  ];
  const winner = rankBinCandidates(bins, { incomingQty: 1, highVelocity: false });
  assert.equal(winner, 'far-zone-emptier');
});

test('rankBinCandidates returns null for an empty candidate list', () => {
  assert.equal(rankBinCandidates([], { incomingQty: 1, highVelocity: false }), null);
});
