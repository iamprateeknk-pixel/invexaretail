import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript');
const source = new URL('../src/lib/saas/studio-report-config.ts', import.meta.url);
const target = new URL('../../web/src/lib/studio-report-config.js', import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(source, 'utf8').replace(/\r\n/g, '\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const generated = '// GENERATED from api/src/lib/saas/studio-report-config.ts. Run api/scripts/sync-studio-report-to-web.mjs.\n' + outputText;
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== generated) {
    console.error('The web Studio report catalog is out of date. Run api/scripts/sync-studio-report-to-web.mjs.');
    process.exitCode = 1;
  }
} else {
  writeFileSync(target, generated);
}
