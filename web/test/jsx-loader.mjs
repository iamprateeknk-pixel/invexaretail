// Week 9: a minimal Node.js ESM loader hook that transforms .jsx source
// with esbuild before Node parses it, so `node --test` can import real
// component files. Every existing test in this repo covers plain .js
// (hooks/lib/control-plane) - none had ever imported a .jsx file, so no
// JSX-capable loader previously existed. Scoped to component-level
// accessibility/permission tests introduced this week
// (src/components/**/*.test.jsx); does not touch the Vite build pipeline.
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TRANSFORM_LOADERS = { '.jsx': 'jsx', '.tsx': 'tsx', '.ts': 'ts' };

export async function load(url, context, nextLoad) {
  const ext = Object.keys(TRANSFORM_LOADERS).find((candidate) => url.endsWith(candidate));
  if (ext) {
    const source = await readFile(new URL(url), 'utf8');
    const { code } = await transform(source, { loader: TRANSFORM_LOADERS[ext], jsx: 'automatic', format: 'esm', sourcefile: url });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}

const SRC_URL = new URL('../src/', import.meta.url);

function resolveExtensionless(url) {
  const path = fileURLToPath(url);
  if (existsSync(path)) return url;
  for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
    if (existsSync(path + ext)) return url + ext;
  }
  return url;
}

export async function resolve(specifier, context, nextResolve) {
  // Mirror vite.config.js's `@` -> `src/` alias and Vite's extensionless
  // import resolution, which only the bundler otherwise understands -
  // node:test imports these files directly.
  if (specifier === '@' || specifier.startsWith('@/')) {
    const rest = specifier.slice(1).replace(/^\//, '');
    return nextResolve(resolveExtensionless(new URL(rest, SRC_URL)).toString(), context);
  }
  if (specifier.startsWith('.') && context.parentURL) {
    const candidate = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(candidate))) {
      return nextResolve(resolveExtensionless(candidate).toString(), context);
    }
  }
  return nextResolve(specifier, context);
}
