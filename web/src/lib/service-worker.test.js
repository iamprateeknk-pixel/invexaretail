import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const handlers = {};

vm.runInNewContext(
  readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'),
  {
    URL,
    Response,
    self: {
      location: { origin: 'https://invexaretail.com' },
      addEventListener(name, handler) {
        handlers[name] = handler;
      }
    },
    caches: {
      open: async () => ({
        match: async () => undefined
      })
    }
  }
);

function intercepted(path, method = 'GET', authorized = false) {
  let result = false;

  handlers.fetch({
    request: {
      url: new URL(path, 'https://invexaretail.com').href,
      method,
      mode: 'cors',
      headers: {
        has: () => authorized
      }
    },
    respondWith() {
      result = true;
    }
  });

  return result;
}

test('private endpoints never use the service worker cache', () => {
  for (const path of [
    '/api/v1/items',
    '/api/v1/auth/me',
    '/api/v1/stock',
    '/control/v1/companies',
    '/studio/v1/config',
    '/sync/v1/pull',
    '/health',
    '/ready',
    '/meta'
  ]) {
    assert.equal(intercepted(path), false, path);
  }
});

test('mutations are never cached', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(intercepted('/api/v1/items', method), false);
  }
});

test('authenticated requests are never cached', () => {
  assert.equal(intercepted('/assets/private.js', 'GET', true), false);
});

test('external requests are not intercepted', () => {
  assert.equal(intercepted('https://example.com/assets/app.js'), false);
});

test('unknown paths are not cached', () => {
  assert.equal(intercepted('/private-report'), false);
});
