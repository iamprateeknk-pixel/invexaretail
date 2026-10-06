#!/usr/bin/env node
// Plan Area J WP5: dependency findings are either fixed or covered by an explicit,
// owned, time-bounded exception - never silently ignored and never an advisory that
// scrolls past in a log. Runs `npm audit --json` in a package directory and fails on any
// high/critical finding that has no unexpired exception in security/audit-exceptions.json.
//
//   node scripts/audit-gate.mjs api            # from the repo root
//
// An exception names the package, why it is not reachable or not fixable now, who owns
// reviewing it and when it expires. An expired exception fails the build again, so a
// deferral cannot quietly become permanent.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKING = new Set(['high', 'critical']);

/**
 * Pure: which findings block, given an audit report and the exception list.
 * Returns { blocking: [...], excepted: [...], expired: [...] }.
 */
export function evaluateAudit(report, exceptions, packageName, now = new Date()) {
  const blocking = [];
  const excepted = [];
  const expired = [];
  for (const [name, vulnerability] of Object.entries(report?.vulnerabilities ?? {})) {
    if (!BLOCKING.has(vulnerability.severity)) continue;
    const match = (exceptions ?? []).find((entry) => entry.package === name && (!entry.scope || entry.scope === packageName));
    if (!match) {
      blocking.push({ name, severity: vulnerability.severity });
    } else if (new Date(match.expires) < now) {
      expired.push({ name, severity: vulnerability.severity, expires: match.expires, reason: match.reason });
    } else {
      excepted.push({ name, severity: vulnerability.severity, expires: match.expires, owner: match.owner });
    }
  }
  return { blocking, excepted, expired };
}

export function validateExceptions(exceptions) {
  const problems = [];
  for (const entry of exceptions ?? []) {
    for (const field of ['package', 'reason', 'owner', 'expires']) {
      if (!entry[field]) problems.push(`exception for "${entry.package ?? '?'}" is missing "${field}"`);
    }
    if (entry.expires && Number.isNaN(new Date(entry.expires).getTime())) problems.push(`exception for "${entry.package}" has an invalid expiry date`);
  }
  return problems;
}

function main() {
  const packageName = process.argv[2];
  if (!packageName) { console.error('Usage: node scripts/audit-gate.mjs <package-dir>'); process.exit(2); }
  const exceptionsPath = join(repoRoot, 'security', 'audit-exceptions.json');
  const exceptions = existsSync(exceptionsPath) ? JSON.parse(readFileSync(exceptionsPath, 'utf8')).exceptions : [];
  const problems = validateExceptions(exceptions);
  if (problems.length) { console.error(`Invalid security/audit-exceptions.json:\n- ${problems.join('\n- ')}`); process.exit(2); }

  const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: join(repoRoot, packageName), shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(run.stdout); } catch { console.error(`Could not read npm audit output for ${packageName}:\n${run.stdout}\n${run.stderr}`); process.exit(2); }
  const { blocking, excepted, expired } = evaluateAudit(report, exceptions, packageName);
  for (const item of excepted) console.log(`excepted  ${item.severity.padEnd(8)} ${item.name}  (owner ${item.owner}, review by ${item.expires})`);
  for (const item of expired) console.error(`EXPIRED   ${item.severity.padEnd(8)} ${item.name}  (exception ended ${item.expires}: ${item.reason})`);
  for (const item of blocking) console.error(`BLOCKING  ${item.severity.padEnd(8)} ${item.name}  (no exception)`);
  if (blocking.length || expired.length) {
    console.error(`\n${packageName}: ${blocking.length + expired.length} high/critical finding(s) need a fix or a reviewed, time-bounded exception in security/audit-exceptions.json.`);
    process.exit(1);
  }
  console.log(`${packageName}: no unexcepted high/critical findings (${excepted.length} excepted).`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/audit-gate.mjs')) main();
