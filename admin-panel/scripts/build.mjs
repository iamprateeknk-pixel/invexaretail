import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlPlaneHtml, DEFAULT_API_BASE, DEFAULT_WEB_APP_URL } from '../src/login-html.js';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = join(root, 'dist');
const apiBase = process.env.VITE_API_BASE || DEFAULT_API_BASE;
// Previously ignored: the build always baked in the default web app URL, so a locked
// company was handed off to the wrong host whatever VITE_WEB_APP_URL said.
const webAppUrl = process.env.VITE_WEB_APP_URL || DEFAULT_WEB_APP_URL;

await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'index.html'), controlPlaneHtml(apiBase, webAppUrl));
console.log(`Wrote Control Plane login to ${dist} (API ${apiBase}, web app ${webAppUrl})`);
