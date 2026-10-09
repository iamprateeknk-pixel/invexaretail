import test from 'node:test';
import assert from 'node:assert/strict';

import { collectCustomValues } from './import-custom-values.js';
import { defaultImportProfile, normalizeImportProfile } from './import-profile.js';
import { saveImportedCustomValuesSafely } from './persistence.js';

const profile = normalizeImportProfile({
  fields: [
    ...defaultImportProfile().fields,
    { label: 'Shelf Rack', type: 'text' },
    { label: 'MRP', type: 'number' },
    { label: 'Best Before', type: 'date' },
  ],
});
const custom = profile.fields.filter((field) => field.custom);

test('collectCustomValues keeps the last non-blank value per item and column', () => {
  const values = collectCustomValues([
    { code: 'A1', extra: { custom_shelf_rack: 'R1', custom_mrp: 10 } },
    { code: 'A1', extra: { custom_shelf_rack: '', custom_mrp: 12 } },
    { code: 'B2', extra: { custom_shelf_rack: null, custom_mrp: null } },
    { code: 'C3', extra: { custom_best_before: '2027-12-31T00:00:00.000Z', not_a_column: 'x' } },
    { code: 'D4' },
  ], custom);
  assert.deepEqual(Object.fromEntries(values.get('A1')!), { custom_shelf_rack: 'R1', custom_mrp: '12' });
  assert.equal(values.has('B2'), false, 'rows with only blank values write nothing');
  assert.deepEqual(Object.fromEntries(values.get('C3')!), { custom_best_before: '2027-12-31' });
  assert.equal(values.has('D4'), false);
});

test('files without custom columns do no work at all', async () => {
  assert.deepEqual(await saveImportedCustomValuesSafely('any-company', [{ code: 'A1' }, { code: 'B2', extra: {} }]), {});
});

test('without a database nothing is written and nothing fails', async () => {
  const result = await saveImportedCustomValuesSafely('any-company', [{ code: 'A1', extra: { custom_mrp: 5 } }]);
  assert.equal(result.customValuesError, undefined);
  assert.deepEqual(result.customValues, { fields: 0, values: 0, unmatchedItems: 0 });
});
