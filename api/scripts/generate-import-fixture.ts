import { writeFileSync } from 'node:fs';
import { buildSalesCsv } from '../src/lib/import-fixtures.js';

const target = process.argv[2] ?? 'sales-5000.csv';
const rows = Number(process.argv[3] ?? 5000);
writeFileSync(target, buildSalesCsv(rows));
process.stdout.write(`Wrote ${rows} sales rows to ${target}\n`);
