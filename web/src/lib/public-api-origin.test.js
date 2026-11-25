import assert from 'node:assert/strict';
import test from 'node:test';
import { publicApiOrigin } from './public-api-origin.js';

test('release builds require an explicit HTTPS API origin', () => {
  for (const value of [undefined, '', 'http://localhost:4000', 'https://api.example.test/api',
    'https://user:pass@api.example.test', 'https://api.example.test/?x=1', 'https://api.example.test/#x',
    'https://api.example.test/path/..', 'https://api.example.test\\']) {
    assert.throws(() => publicApiOrigin(value, { build: true }), /VITE_API_BASE/);
  }
  assert.equal(publicApiOrigin(' https://api.example.test/ ', { build: true }), 'https://api.example.test');
});

test('local development uses the Vite proxy unless an origin is configured', () => {
  assert.equal(publicApiOrigin(undefined), '');
  assert.equal(publicApiOrigin('http://localhost:4000/'), 'http://localhost:4000');
});
