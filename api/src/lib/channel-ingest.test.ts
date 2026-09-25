import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedByConnectorCompany, payloadChecksum } from './channel-ingest.js';

test('checksum is deterministic and changes with any byte of the payload', () => {
  const a = payloadChecksum('{"id":"o1"}');
  assert.equal(a, payloadChecksum('{"id":"o1"}'));
  assert.notEqual(a, payloadChecksum('{"id":"o2"}'));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('a connector can only resolve catalog rows its own company owns', () => {
  assert.equal(ownedByConnectorCompany('company-a', 'company-a'), true);
  assert.equal(ownedByConnectorCompany('company-b', 'company-a'), false);
});

test('untracked (legacy) rows are usable only by the default company, never another tenant', () => {
  assert.equal(ownedByConnectorCompany(undefined, 'default-company'), true);
  assert.equal(ownedByConnectorCompany(undefined, 'company-a'), false);
});
