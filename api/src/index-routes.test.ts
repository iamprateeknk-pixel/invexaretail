import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Week 8: routes/foundation.ts was the unmounted "Phase 1 Prisma blueprint"
// this test used to just document as present-but-unreachable. Its parity
// decision (docs/route-ownership-matrix.md) migrated the unique Branch
// routes to routes/branches.ts (now mounted) and retired the rest as
// superseded/prohibited-pattern duplicates - the file itself is gone.
test('the retired foundation blueprint file no longer exists, and nothing still refers to it', () => {
  assert.equal(existsSync(join(process.cwd(), 'src/routes/foundation.ts')), false);
});
