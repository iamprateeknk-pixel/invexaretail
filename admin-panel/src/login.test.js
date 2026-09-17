import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { controlPlaneHtml } from './login-html.js';
import worker from './worker.js';

test('Cloudflare admin-panel entry renders Control Plane login controls', () => {
  const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
  const main = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
  assert.match(main, /from '\.\/App\.jsx'/);
  assert.match(app, /id="control-email"/);
  assert.match(app, /id="control-password"/);
  assert.match(app, /Sign in/);
  assert.match(app, /\/control\/v1\/auth\/login/);
  assert.equal(app.includes('Admin panel is ready'), false);
  assert.equal(main.includes('Admin panel is ready'), false);
});

test('Worker HTML is Control Plane login, not the stub', () => {
  const html = controlPlaneHtml('https://invexaretail.onrender.com');
  assert.match(html, /id="control-email"/);
  assert.match(html, /id="control-password"/);
  assert.match(html, />Sign in</);
  assert.match(html, /\/control\/v1\/auth\/login/);
  assert.match(html, /data-invexa="control-plane"/);
  assert.match(html, /<title>Invexa Control Plane<\/title>/);
  assert.equal(html.includes('Admin panel is ready'), false);
  assert.equal(html.includes('Invexa Retail Admin Panel'), false);
});

test('Worker serves login HTML with no-store cache headers', async () => {
  const response = await worker.fetch(new Request('https://invexaretail.prateek160298.workers.dev/'), {
    VITE_API_BASE: 'https://invexaretail.onrender.com',
  });
  const html = await response.text();
  assert.equal(response.headers.get('x-invexa-panel'), 'control-plane');
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.match(html, /id="control-email"/);
  assert.match(html, />Sign in</);
});

test('locking a company hands the session off to the web app instead of rendering a dead-end panel', () => {
  const html = controlPlaneHtml('https://invexaretail.onrender.com', 'https://invexaretail.com');
  assert.match(html, /const WEB_APP_URL = "https:\/\/invexaretail\.com"/);
  assert.match(html, /window\.location\.href = WEB_APP_URL \+ "\/#\/control\?session=" \+ encodeURIComponent\(JSON\.stringify\(session\)\)/);
  assert.equal(html.includes('id="company-name"'), false);
  assert.equal(html.includes('id="locked-lede"'), false);
});

test('App.jsx redirects to the web app Control Plane once a company is locked', () => {
  const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
  assert.match(app, /WEB_APP_URL/);
  assert.match(app, /window\.location\.href = `\$\{WEB_APP_URL\}\/#\/control\?session=/);
});
