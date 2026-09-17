import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  isControlPlaneDeployment,
  isControlPlaneHash,
  isControlPlaneRoute,
} from './control-route.js';

test('control hash routes cover #/control and keep workspace hashes out', () => {
  assert.equal(isControlPlaneHash('#/control'), true);
  assert.equal(isControlPlaneHash('#control'), true);
  assert.equal(isControlPlaneHash('#/control/studio'), true);
  assert.equal(isControlPlaneHash('#/dashboard'), false);
  assert.equal(isControlPlaneHash(''), false);
});

test('dedicated control deploys show login without a hash', () => {
  assert.equal(isControlPlaneDeployment({ VITE_APP_MODE: 'control' }), true);
  assert.equal(isControlPlaneDeployment({ VITE_APP_MODE: 'CONTROL' }), true);
  assert.equal(isControlPlaneDeployment({}), false);
  assert.equal(isControlPlaneRoute('', '/', { VITE_APP_MODE: 'control' }), true);
  assert.equal(isControlPlaneRoute('', '/', {}), false);
  assert.equal(isControlPlaneRoute('', '/control', {}), true);
  assert.equal(isControlPlaneRoute('#/control', '/', {}), true);
});

test('App and Cloudflare admin-panel always mount the Control Plane login', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const login = readFileSync(new URL('./ControlPlaneApp.jsx', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../../../admin-panel/src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /isControlPlaneRoute/);
  assert.match(login, /id="control-email"/);
  assert.match(login, /id="control-password"/);
  assert.match(login, /Sign in/);
  assert.match(admin, /id="control-email"/);
  assert.match(admin, /id="control-password"/);
  assert.equal(admin.includes('Admin panel is ready'), false);
});

// control-api.js pulls in api-client.js, which imports offlineStore.ts -
// plain `node --test` (no TS loader) can't resolve that chain, so this
// checks consumeSessionHandoff's source instead of importing and running it.
test('consumeSessionHandoff picks the locked-company session out of the URL fragment', () => {
  const controlApi = readFileSync(new URL('./control-api.js', import.meta.url), 'utf8');
  assert.match(controlApi, /export function consumeSessionHandoff/);
  assert.match(controlApi, /new URLSearchParams\(query\)\.get\('session'\)/);
  assert.match(controlApi, /JSON\.parse\(raw\)/);
  assert.match(controlApi, /writeControlSession\(session\)/);
  assert.match(controlApi, /history\?\.replaceState\?\./);
});

test('ControlPlaneApp consumes a handed-off session before falling back to local storage', () => {
  const login = readFileSync(new URL('./ControlPlaneApp.jsx', import.meta.url), 'utf8');
  assert.match(login, /consumeSessionHandoff\(\) \?\? readControlSession\(\)/);
});
