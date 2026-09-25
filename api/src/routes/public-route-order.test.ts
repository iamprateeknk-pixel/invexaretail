import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Routers that apply `router.use(requireAuth)` reject unauthenticated requests
// before route matching, so a signature-authenticated route mounted after them
// is unreachable (the marketplace webhook answered 401 to everyone until this
// ordering was fixed). Guard the ordering statically: index.ts cannot be
// imported in a test because it starts the server.
test('signature-authenticated routers are mounted before every bearer-authenticated router', () => {
  const source = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8');
  const mountedAt = (name: string) => {
    const at = source.indexOf(`app.use('/api/v1', ${name})`);
    assert.notEqual(at, -1, `${name} must be mounted`);
    return at;
  };
  const authenticated = ['transfersRouter', 'branchesRouter', 'itemsRouter', 'importsRouter', 'reportsRouter', 'coreRouter', 'catalogProcurementRouter', 'operationsExtensionRouter'];
  for (const publicRouter of ['marketplaceWebhookRouter', 'evidenceAccessRouter']) {
    for (const guarded of authenticated) {
      assert.ok(mountedAt(publicRouter) < mountedAt(guarded), `${publicRouter} must precede ${guarded}`);
    }
  }
});
