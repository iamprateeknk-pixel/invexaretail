import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATIONAL_TENANT_TABLES } from './foundation-schema.js';

const CORE_TENANT_MODELS = ['User', 'Branch', 'Location', 'Item'] as const;

test('operational Prisma models declare additive tenantId defaults', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const required = [...CORE_TENANT_MODELS, ...OPERATIONAL_TENANT_TABLES];
  assert.ok(OPERATIONAL_TENANT_TABLES.includes('StockLedger'));
  for (const name of required) {
    const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(match, `missing Prisma model ${name}`);
    assert.match(match[1], /tenantId\s+String\s+@default\("tenant-invexa"\)/);
    assert.match(match[1], /@@index\(\[tenantId\]\)/);
  }
});

test('stock tables never regain the placeholder company default (Phase 3, R3)', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  for (const name of ['StockLedger', 'StockBalance']) {
    const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(match, `missing Prisma model ${name}`);
    assert.doesNotMatch(match[1], /companyId\s+String\s+@default\("default-company"\)/);
  }
  const ledger = schema.match(new RegExp(`model StockLedger \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(ledger);
  assert.match(ledger[1], /@@unique\(\[companyId, itemId, lotId, locationId\]\)/);
  const binStock = schema.match(new RegExp(`model BinStock \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(binStock);
  assert.match(binStock[1], /@@unique\(\[companyId, itemId, lotId, locationId, binId\]\)/);
});
