const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const apiRoot = join(__dirname, '..');
const compose = readFileSync(join(apiRoot, '..', 'docker-compose.yml'), 'utf8').replaceAll('\r\n', '\n');
const runbook = readFileSync(join(apiRoot, '..', 'docs', 'PRODUCTION_RUNBOOK.md'), 'utf8');

test('the Compose release uses the API image for migration and the worker only starts its runtime', () => {
  assert.ok(runbook.includes("docker compose run --rm api sh -ec 'npm run db:migrate && npm run db:verify'"));
  assert.match(compose, /^  worker:\s*\n    build: \.\/api\n    restart: unless-stopped\n    command: \["node", "dist\/worker.js"\]$/m);
  assert.doesNotMatch(compose, /db:migrate|prisma migrate|db:push/);
});

test('the production image includes the database verifier used by the Compose release', () => {
  const dockerfile = readFileSync(join(apiRoot, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY scripts\/verify-production-db\.cjs \.\/scripts\/verify-production-db\.cjs/);
});

test('the Compose web image passes the explicit API origin to the build', () => {
  const dockerfile = readFileSync(join(apiRoot, '..', 'web', 'Dockerfile'), 'utf8').replaceAll('\r\n', '\n');
  assert.match(compose, /  web:\n    build:\n      context: \.\/web\n      args:\n        VITE_API_BASE: \$\{VITE_API_BASE:-https:\/\/invexaretail\.com\}/);
  assert.match(dockerfile, /ARG VITE_API_BASE\nENV VITE_API_BASE=\$VITE_API_BASE\nRUN npm run build/);
});

test('the web container forwards operational, control, Studio and sync requests to the Compose API', () => {
  const nginx = readFileSync(join(apiRoot, '..', 'web', 'nginx.conf'), 'utf8');
  assert.ok(nginx.includes('location ~ ^/(?:(?:api|control|studio|sync)/v1(?:/|$)|(?:health|ready(?:/worker)?|meta)$)'));
  assert.match(nginx, /set \$api_upstream api:4000;/);
  assert.match(nginx, /proxy_pass http:\/\/\$api_upstream;/);
});

test('Compose sends the task rollout flag to the API and the worker with a paused default', () => {
  const value = 'ENABLE_STUDIO_AUTOMATION_TASKS: ${ENABLE_STUDIO_AUTOMATION_TASKS:-false}';
  const api = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  worker:'));
  const worker = compose.slice(compose.indexOf('\n  worker:'), compose.indexOf('\n  web:'));
  assert.ok(api.includes(value));
  assert.ok(worker.includes(value));
});
