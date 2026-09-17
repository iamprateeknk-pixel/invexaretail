import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('index does not mount the unused foundation blueprint router', () => {
  const source = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8');
  assert.equal(source.includes('foundationRouter'), false);
  assert.doesNotMatch(source, /routes\/foundation/);
  assert.equal(existsSync(join(process.cwd(), 'src/routes/foundation.ts')), true);
});
