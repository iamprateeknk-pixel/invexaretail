// Plan Phase 6 exit ("role journeys + accessibility + bundle budget pass"): the production bundle must
// stay inside explicit size budgets, measured as gzip over the wire from the real `dist/` build.
//
//   initial JS  - every script the entry HTML loads before the first screen (the cost every user pays)
//   lazy chunk  - the largest route/page chunk fetched on demand
//   CSS         - all stylesheets
//
// A budget is a ceiling with headroom over today's numbers, not a target: raising one needs a reason in
// the PR. Run after `npm run build`:  npm run budget
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

export const BUDGETS_KB = { initialJs: 260, lazyChunk: 40, css: 25 };

const dist = join(process.cwd(), 'dist');
const gzipKb = (file) => gzipSync(readFileSync(join(dist, file))).length / 1024;

export function measure() {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const referenced = [...new Set([...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((match) => match[1]))];
  const initialJs = referenced.filter((file) => file.endsWith('.js'));
  const allJs = readdirSync(join(dist, 'assets')).filter((file) => file.endsWith('.js')).map((file) => `assets/${file}`);
  const lazy = allJs.filter((file) => !initialJs.includes(file));
  const css = readdirSync(join(dist, 'assets')).filter((file) => file.endsWith('.css')).map((file) => `assets/${file}`);
  const largestLazy = lazy.map((file) => ({ file, kb: gzipKb(file) })).sort((a, b) => b.kb - a.kb)[0] ?? { file: '-', kb: 0 };
  return {
    initialJs: { kb: initialJs.reduce((sum, file) => sum + gzipKb(file), 0), files: initialJs.length },
    lazyChunk: { kb: largestLazy.kb, file: largestLazy.file, count: lazy.length },
    css: { kb: css.reduce((sum, file) => sum + gzipKb(file), 0) },
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const result = measure();
  const rows = [
    ['initial JS', result.initialJs.kb, BUDGETS_KB.initialJs, `${result.initialJs.files} files`],
    ['largest lazy chunk', result.lazyChunk.kb, BUDGETS_KB.lazyChunk, `${result.lazyChunk.file} (of ${result.lazyChunk.count} lazy chunks)`],
    ['CSS', result.css.kb, BUDGETS_KB.css, ''],
  ];
  let failed = false;
  for (const [name, kb, budget, note] of rows) {
    const over = kb > budget;
    failed ||= over;
    console.log(`${over ? 'FAIL' : 'ok  '} ${name.padEnd(20)} ${kb.toFixed(1).padStart(6)} kB gzip / budget ${budget} kB  ${note}`);
  }
  if (failed) {
    console.error('Bundle budget exceeded. Lazy-load the new code or justify raising the budget in scripts/bundle-budget.mjs.');
    process.exit(1);
  }
}
