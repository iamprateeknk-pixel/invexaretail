const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = readFileSync(require.resolve('./app.js'), 'utf8');
function boot({ absent = false, failure } = {}) {
  let logs = '', loads = 0, caught, fallback = 0;
  const loader = name => {
    if (name === 'node:fs') return { writeSync: (_, text) => { logs += text; } };
    if (name === 'node:http') {
      return {
        createServer: () => ({
          listen: (_port, cb) => { fallback++; if (cb) cb(); },
        }),
      };
    }
    loads++;
    if (failure) throw failure;
    return {};
  };
  loader.resolve = () => { if (absent) throw new Error('missing'); return '/api/dist/index.js'; };
  try { runInNewContext(source, { require: loader, process: { version: 'v22.12.0', env: {} }, Date }); }
  catch (error) { caught = error; }
  return { logs, loads, caught, fallback };
}
test('logs entry before loading application, without loading twice', () => {
  const r = boot();
  assert.equal(r.caught, undefined); assert.equal(r.loads, 1); assert.equal(r.fallback, 0);
  assert.match(r.logs, /ENTRY_STARTED[\s\S]*BUILD_OUTPUT_FOUND[\s\S]*MODULES_LOADED/);
});
test('missing compiled entry keeps the process listening', () => {
  const r = boot({ absent: true });
  assert.equal(r.loads, 0); assert.equal(r.fallback, 1);
  assert.match(r.logs, /BUILD_OUTPUT_MISSING/);
  assert.match(r.logs, /FALLBACK_LISTEN/);
});
test('reports missing dependency without printing credential-bearing exception', () => {
  const e = Object.assign(new Error("Cannot find module 'sharp' postgresql://user:SECRET@host/db"), { code: 'MODULE_NOT_FOUND' });
  const r = boot({ failure: e });
  assert.match(r.logs, /STARTUP_FAILED.*MODULE_NOT_FOUND module=sharp/);
  assert.equal(r.fallback, 1);
  assert.doesNotMatch(r.logs + String(r.caught ?? ''), /SECRET|postgresql:/);
});
test('native module errors and arbitrary thrown values fail closed', () => {
  for (const failure of [Object.assign(new Error('SECRET'), { code: 'ERR_DLOPEN_FAILED' }), 'SECRET']) {
    const r = boot({ failure });
    assert.match(r.logs, /STARTUP_FAILED/);
    assert.equal(r.fallback, 1);
    assert.doesNotMatch(r.logs + String(r.caught ?? ''), /SECRET/);
  }
});
