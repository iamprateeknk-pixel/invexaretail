import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlPlaneHtml } from '../src/login-html.js';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = join(root, 'dist');
const html = controlPlaneHtml(process.env.VITE_API_BASE, process.env.VITE_WEB_APP_URL);

await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'index.html'), html);
console.log(`Wrote Control Plane login to ${dist}`);
