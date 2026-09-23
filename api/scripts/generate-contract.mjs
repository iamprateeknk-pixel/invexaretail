#!/usr/bin/env node
// Week 8: regenerate contracts/generated/types.ts from contracts/openapi.json.
// Usage: node scripts/generate-contract.mjs
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // api/
const spec = join(ROOT, 'contracts', 'openapi.json');
const out = join(ROOT, 'contracts', 'generated', 'types.ts');

execFileSync('npx', ['openapi-typescript', spec, '-o', out], { cwd: ROOT, stdio: 'inherit' });
console.log(`Regenerated ${out} from ${spec}`);
