import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceMime } from './transfer-evidence.js';
test('accepts supported photo signatures', () => {
  assert.equal(evidenceMime(Buffer.from([255,216,255,224])), 'image/jpeg');
  assert.equal(evidenceMime(Buffer.from([137,80,78,71,13,10,26,10])), 'image/png');
  assert.equal(evidenceMime(Buffer.from('RIFF1234WEBP')), 'image/webp');
});
test('rejects executable content, empty files and oversized photos', () => {
  assert.throws(() => evidenceMime(Buffer.from('<svg onload="alert(1)"/>')));
  assert.throws(() => evidenceMime(Buffer.alloc(0)));
  assert.throws(() => evidenceMime(Buffer.alloc(5 * 1024 * 1024 + 1)));
});
