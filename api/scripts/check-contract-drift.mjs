#!/usr/bin/env node
// Week 8 CI drift check: regenerate contracts/generated/types.ts from the
// committed contracts/openapi.json into a scratch location and diff it
// against the committed generated file. A mismatch means someone edited
// the spec (or the generated file) without running
// `node scripts/generate-contract.mjs` and committing the result - the
// generated client web/mobile import would then be stale.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // api/
const spec = join(ROOT, 'contracts', 'openapi.json');
const committed = join(ROOT, 'contracts', 'generated', 'types.ts');

const scratch = mkdtempSync(join(tmpdir(), 'contract-drift-'));
const fresh = join(scratch, 'types.ts');
const openapiCli = join(ROOT, 'node_modules', 'openapi-typescript', 'bin', 'cli.js');
try {
  execFileSync(process.execPath, [openapiCli, spec, '-o', fresh], { cwd: ROOT, stdio: 'pipe' });
  const committedText = readFileSync(committed, 'utf8');
  const freshText = readFileSync(fresh, 'utf8');
  if (committedText !== freshText) {
    console.error('contract-drift: contracts/generated/types.ts is out of date with contracts/openapi.json.');
    console.error('Run `node scripts/generate-contract.mjs` and commit the result.');
    process.exit(1);
  }
  console.log('contract-drift: contracts/generated/types.ts matches contracts/openapi.json.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
