// Regenerates web/src/lib/formula.js from src/lib/formula.ts so the browser and the API
// always evaluate formulas identically. `--check` fails if the web copy is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(fileURLToPath(new URL('../src/lib/formula.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const target = fileURLToPath(new URL('../../web/src/lib/formula.js', import.meta.url));
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const generated = `// GENERATED from api/src/lib/formula.ts by api/scripts/sync-formula-to-web.mjs - do not edit.\n${output}`;

if (process.argv.includes('--check')) {
  const current = (() => { try { return readFileSync(target, 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } })();
  if (current !== generated) {
    console.error('web/src/lib/formula.js is out of date. Run: node scripts/sync-formula-to-web.mjs');
    process.exit(1);
  }
  console.log('formula.js is in sync.');
} else {
  writeFileSync(target, generated);
  console.log('Wrote', target);
}
