const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const apiRoot = join(__dirname, '..');
const apiDeployment = JSON.parse(readFileSync(join(apiRoot, 'railway.json'), 'utf8'));
const workerDeployment = JSON.parse(readFileSync(join(apiRoot, 'railway.worker.json'), 'utf8'));

test('the API owns migrations and verifies the database before deployment', () => {
  assert.deepEqual(apiDeployment.deploy.preDeployCommand, ['npm run db:migrate && npm run db:verify']);
  assert.equal(workerDeployment.deploy.preDeployCommand, undefined);
  assert.equal(workerDeployment.deploy.startCommand, 'node dist/worker.js');
});

test('the production image includes the database verifier used by Railway', () => {
  const dockerfile = readFileSync(join(apiRoot, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY scripts\/verify-production-db\.cjs \.\/scripts\/verify-production-db\.cjs/);
});
