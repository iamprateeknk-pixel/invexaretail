import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlPlaneHtml, DEFAULT_API_BASE } from '../src/login-html.js';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = join(root, 'dist');
const apiBase = process.env.VITE_API_BASE || DEFAULT_API_BASE;

await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'index.html'), controlPlaneHtml(apiBase));
await writeFile(
  join(dist, '_headers'),
  `/*
  Cache-Control: no-store, no-cache, must-revalidate
  X-Invexa-Panel: control-plane
`,
);
console.log(`Wrote Control Plane login to ${dist} (API ${apiBase})`);
