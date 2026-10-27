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
  const admin = readFileSync(new URL('../../../admin-panel/src/login-html.js', import.meta.url), 'utf8');
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
// checks the handoff source instead of importing and running it.
test('the handoff carries only a one-time code in the URL, never the session', () => {
  const controlApi = readFileSync(new URL('./control-api.js', import.meta.url), 'utf8');
  assert.match(controlApi, /export async function exchangeSessionHandoff/);
  assert.match(controlApi, /\/control\/v1\/sessions\/handoff\/exchange/);
  assert.match(controlApi, /get\('code'\)/);
  assert.equal(/get\('session'\)/.test(controlApi), false, 'the old session-in-URL path is gone');
  assert.match(controlApi, /history\?\.replaceState\?\./, 'the code is scrubbed from the address bar before the exchange');
});

test('the control session lives in sessionStorage and the old localStorage copy is removed', () => {
  const controlApi = readFileSync(new URL('./control-api.js', import.meta.url), 'utf8');
  assert.match(controlApi, /sessionStorage\?\.setItem/);
  assert.equal(/localStorage\?\.setItem/.test(controlApi), false);
  assert.match(controlApi, /localStorage\?\.removeItem/);
});

test('ControlPlaneApp exchanges a handoff code before showing the login form', () => {
  const login = readFileSync(new URL('./ControlPlaneApp.jsx', import.meta.url), 'utf8');
  // Phase 4 extracted the exchange into use-control-session.js; the app
  // still gates the login form on its `exchanging` flag, so the behaviour
  // this test pins is unchanged - only the file holding the call moved.
  const session = readFileSync(new URL('./use-control-session.js', import.meta.url), 'utf8');
  assert.match(session, /exchangeSessionHandoff\(\)/);
  assert.match(login, /exchanging/);
  assert.match(login, /Opening the Control Plane/);
  assert.equal(login.includes('consumeSessionHandoff'), false);
});
