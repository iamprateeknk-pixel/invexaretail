#!/usr/bin/env node
// Phase 7: one command that runs the checks CI runs, in the order that fails
// fastest, so a change can be verified before pushing.
//
//   node scripts/verify.mjs            # api + web (no database needed)
//   node scripts/verify.mjs --quick    # typecheck + lint only
//   node scripts/verify.mjs --mobile   # also run flutter analyze + test
//
// Real-Postgres suites are not included (they need a database): see
// docs/phase6-performance-deploy.md and api/src/**/*.postgres.test.ts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const quick = args.has('--quick');
const withMobile = args.has('--mobile');

export function buildSteps({ quick = false, withMobile = false } = {}) {
  const steps = [
    { name: 'api: typecheck', cwd: 'api', cmd: 'npx tsc --noEmit' },
    { name: 'api: architecture lint', cwd: 'api', cmd: 'npm run lint:arch' },
    { name: 'web: lint', cwd: 'web', cmd: 'npm run lint' },
  ];
  if (!quick) {
    steps.push(
      { name: 'api: contract drift', cwd: 'api', cmd: 'npm run contract:check-drift' },
      { name: 'api: tests (memory mode)', cwd: 'api', cmd: 'npm test' },
      { name: 'api: load-probe stats', cwd: 'api', cmd: 'node --test scripts/load-test.test.mjs' },
      { name: 'web: tests', cwd: 'web', cmd: 'npm test' },
      { name: 'web: component tests', cwd: 'web', cmd: 'npm run test:components' },
      { name: 'web: build', cwd: 'web', cmd: 'npm run build' },
    );
  }
  if (withMobile) {
    steps.push(
      { name: 'mobile: analyze', cwd: 'mobile', cmd: 'flutter analyze' },
      { name: 'mobile: tests', cwd: 'mobile', cmd: 'flutter test' },
    );
  }
  return steps;
}

function main() {
  const steps = buildSteps({ quick, withMobile });
  const results = [];
  for (const step of steps) {
    const started = Date.now();
    process.stdout.write(`\n▶ ${step.name}  (${step.cwd}: ${step.cmd})\n`);
    const run = spawnSync(step.cmd, { cwd: join(root, step.cwd), shell: true, stdio: 'inherit' });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ name: step.name, ok: run.status === 0, seconds });
    if (run.status !== 0) break; // fail fast: later steps rarely say more than the first failure
  }
  console.log('\n──────── summary ────────');
  for (const result of results) console.log(`${result.ok ? '✔' : '✖'} ${result.name}  ${result.seconds}s`);
  const skipped = steps.length - results.length;
  if (skipped > 0) console.log(`(${skipped} step${skipped === 1 ? '' : 's'} not run after the failure)`);
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/scripts/verify.mjs')) main();
