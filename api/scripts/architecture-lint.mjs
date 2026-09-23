#!/usr/bin/env node
// Lightweight, regex-based check for the prohibited patterns in AGENTS.md.
// This is best-effort, not a type-aware analysis: it flags likely violations
// for a human to confirm, and it is deliberately conservative (false
// negatives over false positives) so it stays cheap to run on every PR.
//
// Reports existing violations (the baseline, does not fail CI) separately
// from new violations (fails CI) per AGENTS.md / ADR-001..006, so adopting
// this script does not block on the ~8 pre-existing StockLedger write sites
// or the large pre-existing Float-quantity surface.
//
// Usage:
//   node scripts/architecture-lint.mjs            # report only
//   node scripts/architecture-lint.mjs --check     # exit 1 on new violations
//   node scripts/architecture-lint.mjs --update-baseline
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // api/
const BASELINE_PATH = join(ROOT, 'scripts', 'architecture-lint-baseline.json');

function listFiles() {
  const out = execSync('git ls-files "src/**/*.ts"', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter((f) => !f.endsWith('.test.ts'));
}

// Files allowed to write StockLedger/StockMovement/StockBalance directly
// (ADR-001 baseline + the canonical posting service). Anything else touching
// these tables is a new violation. The baseline files are not yet routed
// through InventoryPostingService (see docs/inventory-posting-coverage.md
// for why each one's field shape - onHand+quarantine transitions, reserved-
// only changes - does not map onto the service's current onHand-delta
// command shape) - they stay allowlisted, not because direct writes are
// fine there, but because the guide's own scope for this week is "block
// NEW direct writes," not "silently break the existing ones by revoking
// their access before they have anywhere else to go."
const STOCK_WRITE_ALLOWLIST = new Set([
  'src/lib/reservation.ts',
  'src/lib/transfer-receipt.ts',
  'src/lib/orders.ts',
  'src/lib/import-reversal.ts',
  'src/lib/exceptions.ts',
  'src/lib/persistence.ts',
  'src/routes/catalog-procurement.ts',
  'src/routes/operations-extension.ts',
  'src/routes/foundation.ts',
  // The canonical service itself, and its reconciliation tooling.
  'src/lib/inventory-posting-service.ts',
]);

const RULES = [
  {
    id: 'runtime-ddl',
    description: 'CREATE/ALTER/DROP TABLE outside prisma/migrations (AGENTS.md #4, ADR-004)',
    test(file, line) {
      return /\b(CREATE|ALTER|DROP)\s+TABLE\b/i.test(line);
    },
  },
  {
    id: 'direct-stock-write',
    description: 'StockLedger/StockMovement/StockBalance write outside the ADR-001 posting-service allowlist',
    test(file, line) {
      if (STOCK_WRITE_ALLOWLIST.has(file)) return false;
      return /prisma\.(stockLedger|stockMovement|stockBalance)\.(create|update|upsert|createMany|updateMany)\(/.test(line)
        || /"(StockLedger|StockMovement|StockBalance)"/.test(line);
    },
  },
  {
    id: 'custom-crypto',
    description: 'Hand-rolled crypto instead of bcrypt/jsonwebtoken (AGENTS.md #5)',
    test(file, line) {
      return /createCipher(?!iv)|\bxorEncrypt\b|\bcustomEncrypt\b|Buffer\.from\([^)]*\)\s*\^/.test(line);
    },
  },
  {
    id: 'float-money',
    description: 'Float used for a money-like field in schema.prisma (AGENTS.md #3)',
    // Checked separately in run() against prisma/schema.prisma, not per-.ts-line.
    test() {
      return false;
    },
  },
  {
    id: 'unscoped-tenant-query',
    description: 'prisma.item.* call with no companyId/tenantId nearby (AGENTS.md #2, ADR-002) - pilot rule, Item model only',
    // Checked separately in run() with a multi-line window, not per-single-line.
    test() {
      return false;
    },
  },
];

// ADR-002 pilot: only prisma.item.* is checked for now (the model this
// week's tenant-scoping work covers - see lib/repositories/item-repository.ts).
// Extending this to every OPERATIONAL_TENANT_TABLES model is future work;
// a naive multi-line window check gets noisier the more models it covers.
const UNSCOPED_QUERY_PATTERN = /prisma\.item\.(findMany|findFirst|findUnique|update|updateMany|delete|deleteMany|upsert|create|createMany)\(/;
const UNSCOPED_QUERY_WINDOW = 8; // lines to look ahead for a companyId/tenantId mention

function findUnscopedTenantQueries(file, lines) {
  const violations = [];
  lines.forEach((line, idx) => {
    if (!UNSCOPED_QUERY_PATTERN.test(line)) return;
    const window = lines.slice(idx, idx + UNSCOPED_QUERY_WINDOW).join('\n');
    if (/companyId|tenantId/.test(window)) return;
    violations.push({ rule: 'unscoped-tenant-query', file, line: idx + 1, snippet: line.trim().slice(0, 160) });
  });
  return violations;
}

const MONEY_FIELD_NAME = /^\s*\w*(price|cost|amount|total|tax|discount|freight|landedCost|mrp|value|refund)\w*\s+Float\b/i;

function run() {
  const files = listFiles();
  const violations = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      for (const rule of RULES) {
        if (rule.test(file, line)) {
          violations.push({ rule: rule.id, file, line: idx + 1, snippet: line.trim().slice(0, 160) });
        }
      }
    });
    violations.push(...findUnscopedTenantQueries(file, lines));
  }
  const schemaPath = join(ROOT, 'prisma', 'schema.prisma');
  if (existsSync(schemaPath)) {
    const schemaLines = readFileSync(schemaPath, 'utf8').split('\n');
    schemaLines.forEach((line, idx) => {
      if (MONEY_FIELD_NAME.test(line)) {
        violations.push({ rule: 'float-money', file: 'prisma/schema.prisma', line: idx + 1, snippet: line.trim().slice(0, 160) });
      }
    });
  }
  return violations;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return [];
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function key(v) {
  return `${v.rule}::${v.file}::${v.line}`;
}

const args = process.argv.slice(2);
const violations = run();

if (args.includes('--update-baseline')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(violations, null, 2) + '\n');
  console.log(`Wrote ${violations.length} baseline violations to ${relative(ROOT, BASELINE_PATH)}`);
  process.exit(0);
}

const baseline = new Set(loadBaseline().map(key));
const existing = violations.filter((v) => baseline.has(key(v)));
const fresh = violations.filter((v) => !baseline.has(key(v)));

for (const rule of RULES) {
  const ruleExisting = existing.filter((v) => v.rule === rule.id).length;
  const ruleFresh = fresh.filter((v) => v.rule === rule.id).length;
  console.log(`\n[${rule.id}] ${rule.description}`);
  console.log(`  existing (baseline, non-blocking): ${ruleExisting}`);
  console.log(`  new (blocking):                    ${ruleFresh}`);
}

if (fresh.length) {
  console.log('\nNew violations:');
  for (const v of fresh) console.log(`  ${v.file}:${v.line} [${v.rule}] ${v.snippet}`);
}

if (args.includes('--check') && fresh.length > 0) {
  console.error(`\narchitecture-lint: ${fresh.length} new violation(s). Fix them or, if intentional, update the ADR and run --update-baseline.`);
  process.exit(1);
}

console.log(`\narchitecture-lint: ${existing.length} existing (tracked), ${fresh.length} new violation(s).`);
