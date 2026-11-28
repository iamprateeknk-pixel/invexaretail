import assert from 'node:assert/strict';

const { VITE_WEB_APP_URL: web, PUBLIC_CONTROL_URL: control, SEED_PASSWORD: password } = process.env;
assert.ok(web && control && password, 'The Compose fixture requires web and control origins and its seed password.');
const base = process.argv[2] ?? 'http://127.0.0.1:5173';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d{1,5}$/, 'The smoke test uses an isolated loopback service.');

async function post(path, origin, body, { token, status = 200, cors = origin } = {}) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(token && { Authorization: 'Bearer ' + token }) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, status, path);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), cors, path);
  return response.json();
}

const workspace = await post('/api/v1/auth/login', web, { email: 'admin@retail.local', password });
assert.ok(workspace.token, 'The operational admin can sign in from the staging workspace.');

const platform = await post('/control/v1/auth/login', control, { email: 'superadmin@invexa.local', password });
const locked = await post('/control/v1/sessions/select-company', control, { companyId: 'default-company' }, {
  token: platform.token,
});
const session = { platformToken: platform.token, controlToken: locked.token, company: locked.company };
const issued = await post('/control/v1/sessions/handoff', control, { session }, { token: locked.token, status: 201 });
const exchange = '/control/v1/sessions/handoff/exchange';
const refused = await post(exchange, 'https://invexaretail.com', { code: issued.code }, { status: 403, cors: null });
assert.equal(refused.code, 'CSRF_ORIGIN_MISMATCH');
const redeemed = await post(exchange, web, { code: issued.code });
assert.ok(redeemed.session.controlToken === locked.token, 'The approved staging workspace receives the locked session.');
await post(exchange, web, { code: issued.code }, { status: 401 });
console.log('Operational sign-in and one-time Control Plane handoff passed.');
