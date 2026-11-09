// [ULTRA] P3 (#186): unit tests for the zod schemas — valid payloads
// pass (including the coercions each handler already did), invalid
// payloads fail, and boundary values behave exactly as the hand-rolled
// checks did (a numeric string is accepted only where the handler
// coerced it, rejected where the handler checked the raw value).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transferInputSchema,
  transferStatusSchema,
  transferPickerSchema,
  allocationPreviewSchema,
  pickSlipSchema,
  transferReceiveSchema,
  countSubmitSchema,
  weightCountSchema,
  countReviewSchema,
  countReconciliationAckSchema,
  countAssignmentSchema,
  countAssignmentUpdateSchema,
  countAssignmentBulkDeleteSchema,
  cycleCountAssignSchema,
  returnCreateSchema,
  returnDispositionSchema,
  returnRefundSchema,
  orderCreateSchema,
  packScanSchema,
  tagCreateSchema,
  customFieldCreateSchema,
  reorderSuggestionAcceptSchema,
  reorderRuleSchema,
  purchaseOrderCreateSchema,
  poReceiveSchema,
  purchaseOrderStatusSchema,
  poPlanDraftSchema,
  poInvoiceSchema,
  priceCreateSchema,
  priceBreaksSchema,
  savedReportSchema,
  savedViewSchema,
} from './validation-schemas.js';

const ok = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  assert.equal(schema.safeParse(value).success, true, JSON.stringify(value));
const bad = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  assert.equal(schema.safeParse(value).success, false, JSON.stringify(value));

const transferLines = [{ itemId: 'item-1', lotId: 'lot-1', quantity: 2 }];

test('transfer input: valid, same-source rejected, string quantity rejected (raw-value check)', () => {
  ok(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: transferLines });
  ok(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: transferLines, cartonCount: '3' });
  ok(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: transferLines, cartonCount: '' });
  bad(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'loc-1', lines: transferLines });
  bad(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: [] });
  bad(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: [{ itemId: 'item-1', lotId: 'lot-1', quantity: '2' }] });
  bad(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: [{ itemId: 'item-1', lotId: 'lot-1', quantity: 0 }] });
  bad(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: [{ itemId: 'item-1', quantity: 1 }] });
  bad(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: transferLines, cartonCount: 1.5 });
  bad(transferInputSchema, { sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: transferLines, cartonCount: 0 });
  bad(transferInputSchema, { destinationLocationId: 'wh-1', lines: transferLines });
});

test('transfer status / picker / allocation-preview', () => {
  ok(transferStatusSchema, { status: 'DISPATCHED' });
  ok(transferStatusSchema, { status: 'PARTIAL_RECEIVED' });
  bad(transferStatusSchema, { status: 'BOGUS' });
  bad(transferStatusSchema, { status: 123 });
  ok(transferPickerSchema, { pickerId: 'user-1' });
  ok(transferPickerSchema, { pickerId: null });
  bad(transferPickerSchema, {});
  bad(transferPickerSchema, { pickerId: 123 });
  ok(allocationPreviewSchema, { itemId: 'item-1' });
  bad(allocationPreviewSchema, { itemId: '' });
  bad(allocationPreviewSchema, {});
});

test('pick slips: lines or exceptions required; pooled lines need no lot', () => {
  ok(pickSlipSchema, { lines: [{ itemId: 'item-1', lotId: 'lot-1', quantity: 1, inputMethod: 'SCAN', scanCode: 'item-1' }] });
  ok(pickSlipSchema, { lines: [{ itemId: 'item-1', quantity: 2.5 }] });
  ok(pickSlipSchema, { exceptions: [{ reason: 'NO_STOCK', quantity: 1, itemId: 'item-1' }] });
  bad(pickSlipSchema, {});
  bad(pickSlipSchema, { lines: [], exceptions: [] });
  bad(pickSlipSchema, { lines: [{ itemId: 'item-1', lotId: 'lot-1', quantity: 0 }] });
  // A numeric string quantity coerces (the handler does Number(line.quantity)) — accepted, as before.
  ok(pickSlipSchema, { lines: [{ itemId: 'item-1', lotId: 'lot-1', quantity: '2' }] });
  bad(pickSlipSchema, { exceptions: [{ reason: 'No Stock', quantity: 1 }] });
  bad(pickSlipSchema, { exceptions: [{ reason: 'NO_STOCK', quantity: 0 }] });
});

test('transfer receive: requestId required and bounded; lines optional for the single-line fallback', () => {
  ok(transferReceiveSchema, { requestId: 'req-1', lines: [{ itemId: 'i', lotId: 'l', receivedQty: 1 }] });
  ok(transferReceiveSchema, { requestId: 'req-1' });
  ok(transferReceiveSchema, { requestId: 'req-1', receivedQty: 2 });
  ok(transferReceiveSchema, { requestId: '  req-1  ', lines: [{ itemId: 'i', lotId: 'l', receivedQty: 1, damagedQty: 0 }] });
  bad(transferReceiveSchema, { requestId: '' });
  bad(transferReceiveSchema, { requestId: 'x'.repeat(192) });
  bad(transferReceiveSchema, { lines: [{ itemId: 'i', lotId: 'l', receivedQty: 1 }] });
  bad(transferReceiveSchema, { requestId: 'req-1', lines: [] });
  bad(transferReceiveSchema, { requestId: 'req-1', lines: [{ itemId: 'i', lotId: 'l' }] });
});

test('count submit: strict numbers (a numeric string is rejected, as before)', () => {
  ok(countSubmitSchema, { itemId: 'i', locationId: 'l', physicalQuantity: 0 });
  ok(countSubmitSchema, { itemId: 'i', locationId: 'l', physicalQuantity: 2.5, mode: 'weight', requestId: 'r-1' });
  bad(countSubmitSchema, { itemId: 'i', locationId: 'l', physicalQuantity: '5' });
  bad(countSubmitSchema, { itemId: 'i', locationId: 'l', physicalQuantity: -1 });
  bad(countSubmitSchema, { itemId: 'i', locationId: 'l', physicalQuantity: Number.NaN });
  bad(countSubmitSchema, { itemId: 'i', locationId: 'l' });
  bad(countSubmitSchema, { itemId: 'i', locationId: 'l', physicalQuantity: 1, requestId: 'x'.repeat(192) });
});

test('weight count: empty/null total is invalid, 0 is valid, numeric strings coerce', () => {
  ok(weightCountSchema, { itemId: 'i', locationId: 'l', totalQuantity: 0 });
  ok(weightCountSchema, { itemId: 'i', locationId: 'l', totalQuantity: '2.5' });
  bad(weightCountSchema, { itemId: 'i', locationId: 'l', totalQuantity: '' });
  bad(weightCountSchema, { itemId: 'i', locationId: 'l', totalQuantity: null });
  bad(weightCountSchema, { itemId: 'i', locationId: 'l' });
  bad(weightCountSchema, { itemId: 'i', locationId: 'l', totalQuantity: -1 });
  bad(weightCountSchema, { itemId: '', locationId: 'l', totalQuantity: 1 });
});

test('count review: aliases, reason fallback, reason codes', () => {
  ok(countReviewSchema, { status: 'APPROVED', reviewReason: 'looks good' });
  ok(countReviewSchema, { status: 'approve', reason: 'looks good' });
  ok(countReviewSchema, { status: 'reject', reviewReason: 'wrong lot' });
  ok(countReviewSchema, { status: 'RECOUNT', reviewReason: 'recount it', reasonCode: 'miscOUNT' });
  ok(countReviewSchema, { status: 'APPROVED', reviewReason: 'fine here', reasonCode: '' });
  bad(countReviewSchema, { status: 'APPROVED', reviewReason: 'no' });
  bad(countReviewSchema, { status: 'APPROVED', reason: 'no' });
  bad(countReviewSchema, { status: 'APPROVED' });
  bad(countReviewSchema, { status: 'MAYBE', reviewReason: 'looks good' });
  bad(countReviewSchema, { status: 'APPROVED', reviewReason: 'looks good', reasonCode: 'NOPE' });
});

test('count ack / assignments / bulk delete / cycle assign', () => {
  ok(countReconciliationAckSchema, { note: 'checked' });
  bad(countReconciliationAckSchema, { note: 'no' });
  bad(countReconciliationAckSchema, { note: 123 });
  ok(countAssignmentSchema, { locationId: 'l', storeUserId: 'u', itemIds: ['i'] });
  ok(countAssignmentSchema, { locationId: 'l', storeUserId: 'u', itemIds: ['i'], priority: 'urgent', countDate: '2026-11-01' });
  bad(countAssignmentSchema, { locationId: 'l', storeUserId: 'u', itemIds: [] });
  bad(countAssignmentSchema, { locationId: 'l', storeUserId: 'u', itemIds: ['i'], priority: 'CRITICAL' });
  bad(countAssignmentSchema, { locationId: 'l', storeUserId: 'u', itemIds: ['i'], countDate: 'not-a-date' });
  ok(countAssignmentUpdateSchema, { status: 'cancelled' });
  ok(countAssignmentUpdateSchema, {});
  bad(countAssignmentUpdateSchema, { status: 'DONE' });
  bad(countAssignmentUpdateSchema, { countDate: 'not-a-date' });
  ok(countAssignmentBulkDeleteSchema, { assignmentIds: ['a', 'b'] });
  bad(countAssignmentBulkDeleteSchema, { assignmentIds: [] });
  bad(countAssignmentBulkDeleteSchema, { assignmentIds: [''] });
  bad(countAssignmentBulkDeleteSchema, { assignmentIds: 'a' });
  ok(cycleCountAssignSchema, { storeUserId: 'u' });
  const parsed = cycleCountAssignSchema.safeParse({ storeUserId: 'u', classes: ['b', 'zz', 7] });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.data.classes, ['B']);
  bad(cycleCountAssignSchema, { storeUserId: 'u', classes: 'A' });
  bad(cycleCountAssignSchema, { storeUserId: 'u', classes: ['zz'] });
  bad(cycleCountAssignSchema, { classes: ['A'] });
});

test('returns: create / disposition / refund', () => {
  ok(returnCreateSchema, { lines: [{ orderLineId: 'ol-1', quantity: 1 }] });
  ok(returnCreateSchema, { lines: [{ orderLineId: 'ol-1', quantity: '2' }] });
  bad(returnCreateSchema, { lines: [] });
  bad(returnCreateSchema, { lines: [{ orderLineId: 'ol-1', quantity: 0 }] });
  bad(returnCreateSchema, { lines: [{ orderLineId: 'ol-1' }] });
  bad(returnCreateSchema, {});
  ok(returnDispositionSchema, { disposition: 'RESTOCK' });
  ok(returnDispositionSchema, {});
  bad(returnDispositionSchema, { disposition: 123 });
  ok(returnRefundSchema, { status: 'REFUNDED' });
  bad(returnRefundSchema, { status: 'refunded' });
  bad(returnRefundSchema, { status: 'PENDING' });
});

test('order create: junk lines are dropped like the handler drops them; pack scan defaults', () => {
  const parsed = orderCreateSchema.safeParse({
    channel: '  web  ',
    lines: [
      { itemId: 'i1', quantity: '2', minRslPercent: '50' },
      { itemId: '', quantity: 1 },
      { itemId: 'i2', quantity: 0 },
      { itemId: 'i3', quantity: 'x' },
    ],
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.channel, 'web');
    assert.deepEqual(parsed.data.lines, [{ itemId: 'i1', quantity: 2, minRslPercent: 50 }]);
  }
  bad(orderCreateSchema, { channel: 'web', lines: [{ itemId: '', quantity: 1 }] });
  bad(orderCreateSchema, { channel: '', lines: [{ itemId: 'i1', quantity: 1 }] });
  bad(orderCreateSchema, { lines: [{ itemId: 'i1', quantity: 1 }] });
  ok(packScanSchema, { itemId: 'i' });
  ok(packScanSchema, { itemId: 'i', quantity: '2' });
  bad(packScanSchema, { itemId: 'i', quantity: 0 });
  bad(packScanSchema, { itemId: '' });
});

test('parity fixes: empty countDate counts as absent; non-string assignee is dropped; bulk-delete drops junk ids', () => {
  // Both assignment handlers treat '' countDate as "use the default"
  // (`countDate ? ... : <default>`), so the schema must not reject it.
  ok(countAssignmentSchema, { locationId: 'l', storeUserId: 'u', itemIds: ['i'], countDate: '' });
  ok(countAssignmentUpdateSchema, { countDate: '' });
  ok(purchaseOrderCreateSchema, { supplierId: 's', locationId: 'l', lines: [{ itemId: 'i', quantity: 1 }], expectedAt: '' });
  ok(poInvoiceSchema, { invoiceNumber: 'INV-1', lines: [{ itemId: 'i', invoicedQty: 1 }], invoiceDate: '' });
  bad(countAssignmentSchema, { locationId: 'l', storeUserId: 'u', itemIds: ['i'], countDate: 'not-a-date' });

  // The update handler falls back to the current assignee for a
  // non-string assignedToId, so the schema drops it instead of failing.
  const dropped = countAssignmentUpdateSchema.safeParse({ assignedToId: 123, status: 'ASSIGNED' });
  assert.equal(dropped.success, true);
  if (dropped.success) assert.equal(dropped.data.assignedToId, undefined);
  ok(countAssignmentUpdateSchema, { assignedToId: 'user-1' });

  // The bulk-delete handler filters junk entries, trims and dedupes;
  // only an empty result is rejected.
  const filtered = countAssignmentBulkDeleteSchema.safeParse({ assignmentIds: ['a', 123, '', '  b  ', 'a', null] });
  assert.equal(filtered.success, true);
  if (filtered.success) assert.deepEqual(filtered.data.assignmentIds, ['a', 'b']);
  bad(countAssignmentBulkDeleteSchema, { assignmentIds: [123, '', null] });
});

test('procurement: tags, custom fields, reorder rules, PO create/receive/status, invoices, prices', () => {
  ok(tagCreateSchema, { name: '  fresh  ' });
  bad(tagCreateSchema, { name: 'x' });
  bad(tagCreateSchema, { name: 123 });
  ok(customFieldCreateSchema, { name: 'Batch' });
  bad(customFieldCreateSchema, { name: 'x' });
  ok(reorderSuggestionAcceptSchema, { locationId: 'l' });
  bad(reorderSuggestionAcceptSchema, { locationId: '' });
  ok(reorderRuleSchema, { locationId: 'l', orderMultiple: '6' });
  ok(reorderRuleSchema, { locationId: 'l', orderMultiple: null });
  bad(reorderRuleSchema, { locationId: 'l', orderMultiple: 0 });
  bad(reorderRuleSchema, { locationId: 'l', orderMultiple: 'x' });
  bad(reorderRuleSchema, { locationId: '' });
  ok(purchaseOrderCreateSchema, { supplierId: 's', locationId: 'l', lines: [{ itemId: 'i', quantity: '2', unitCost: '10' }] });
  bad(purchaseOrderCreateSchema, { supplierId: 's', locationId: 'l', lines: [{ itemId: 'i', quantity: 0 }] });
  bad(purchaseOrderCreateSchema, { supplierId: 's', locationId: 'l', lines: [] });
  bad(purchaseOrderCreateSchema, { supplierId: '', locationId: 'l', lines: [{ itemId: 'i', quantity: 1 }] });
  bad(purchaseOrderCreateSchema, { supplierId: 's', locationId: 'l', lines: [{ itemId: 'i', quantity: 1 }], expectedAt: 'nope' });
  ok(poReceiveSchema, { requestId: 'r-1', lines: [{ receivedQty: 2 }] });
  ok(poReceiveSchema, { requestId: 'r-1' });
  bad(poReceiveSchema, { requestId: '' });
  bad(poReceiveSchema, { requestId: 'r-1', lines: [] });
  ok(purchaseOrderStatusSchema, { status: 'APPROVED' });
  bad(purchaseOrderStatusSchema, { status: 'approved' });
  bad(purchaseOrderStatusSchema, { status: 'SHIPPED' });
  ok(poPlanDraftSchema, { locationId: 'l', groups: [{ supplierId: 's', lines: [{ itemId: 'i', quantity: 1 }] }] });
  bad(poPlanDraftSchema, { locationId: 'l', groups: [] });
  const invoice = poInvoiceSchema.safeParse({
    invoiceNumber: ' INV-1 ',
    lines: [
      { itemId: 'i1', invoicedQty: '2', unitCost: '5' },
      { itemId: '', invoicedQty: 1, unitCost: 5 },
    ],
  });
  assert.equal(invoice.success, true);
  if (invoice.success) {
    assert.equal(invoice.data.invoiceNumber, 'INV-1');
    assert.deepEqual(invoice.data.lines, [{ itemId: 'i1', invoicedQty: 2, unitCost: 5 }]);
  }
  bad(poInvoiceSchema, { invoiceNumber: 'INV-1', lines: [{ itemId: '', invoicedQty: 1 }] });
  ok(priceCreateSchema, { priceType: 'RETAIL', price: '99.5' });
  bad(priceCreateSchema, { priceType: 'RETAIL', price: 0 });
  bad(priceCreateSchema, { priceType: '', price: 10 });
  ok(priceBreaksSchema, { breaks: [{ minQty: 1, unitCost: 10 }, { minQty: 5, unitCost: 8 }] });
  ok(priceBreaksSchema, { breaks: 'junk' });
  ok(priceBreaksSchema, { breaks: [] });
  bad(priceBreaksSchema, { breaks: [{ minQty: 1, unitCost: 10 }, { minQty: 1, unitCost: 9 }] });
  bad(priceBreaksSchema, { breaks: [{ minQty: 1, unitCost: 8 }, { minQty: 5, unitCost: 10 }] });
  bad(priceBreaksSchema, { breaks: [{ minQty: 0, unitCost: 10 }] });
  ok(savedReportSchema, { name: 'Weekly', reportType: 'moves' });
  bad(savedReportSchema, { name: 'Weekly', reportType: 'bogus' });
  bad(savedReportSchema, { name: 'W', reportType: 'moves' });
  ok(savedViewSchema, { name: 'My view' });
  bad(savedViewSchema, { name: 'x' });
});
