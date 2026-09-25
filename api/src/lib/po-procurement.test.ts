import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedPoMoves, checkPoMove, isReceivablePo } from './po-lifecycle.js';
import { planPoReceipt, statusAfterReceipt, type PoLine } from './po-receipt.js';
import { groupBySupplier, planPurchases } from './po-planning.js';

const message = (result: { ok: boolean }) => ('message' in result ? String((result as { message: string }).message) : '');

// ---- lifecycle ------------------------------------------------------------

test('a purchase order follows draft -> approval -> send, and cannot skip approval', () => {
  assert.deepEqual(allowedPoMoves('DRAFT'), ['SUBMITTED', 'CANCELLED']);
  assert.equal(checkPoMove({ from: 'DRAFT', to: 'APPROVED', anyReceived: false, invoiceStatuses: [] }).ok, false);
  assert.equal(checkPoMove({ from: 'SUBMITTED', to: 'APPROVED', anyReceived: false, invoiceStatuses: [] }).ok, true);
  assert.equal(checkPoMove({ from: 'APPROVED', to: 'SENT', anyReceived: false, invoiceStatuses: [] }).ok, true);
  assert.equal(checkPoMove({ from: 'RECEIVED', to: 'DRAFT', anyReceived: true, invoiceStatuses: [] }).ok, false);
  assert.deepEqual(allowedPoMoves('CANCELLED'), []);
});

test('goods can only be received against an approved, open order', () => {
  for (const status of ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED']) assert.equal(isReceivablePo(status), true);
  for (const status of ['DRAFT', 'SUBMITTED', 'RECEIVED', 'CLOSED', 'CANCELLED']) assert.equal(isReceivablePo(status), false);
});

test('an order with goods against it cannot be cancelled; closing follows the invoice match', () => {
  const cancelled = checkPoMove({ from: 'APPROVED', to: 'CANCELLED', anyReceived: true, invoiceStatuses: [] });
  assert.equal(cancelled.ok, false);
  const noInvoice = checkPoMove({ from: 'RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: [] });
  assert.match(message(noInvoice), /No supplier invoice/);
  assert.equal(checkPoMove({ from: 'RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: ['EXCEPTION'], note: 'Supplier credit note pending' }).ok, true);
  assert.equal(checkPoMove({ from: 'RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: ['EXCEPTION', 'MATCHED'] }).ok, true);
  const short = checkPoMove({ from: 'PARTIALLY_RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: ['MATCHED'] });
  assert.match(message(short), /short close/);
  assert.equal(checkPoMove({ from: 'PARTIALLY_RECEIVED', to: 'CLOSED', anyReceived: true, invoiceStatuses: ['MATCHED'], note: 'Supplier will not ship the rest' }).ok, true);
});

// ---- receipt --------------------------------------------------------------

const lines: PoLine[] = [
  { id: 'l1', itemId: 'milk', quantity: 10, receivedQty: 0, unitCost: 5 },
  { id: 'l2', itemId: 'rice', quantity: 4, receivedQty: 1, unitCost: 40 },
];
const items = new Map([
  ['milk', { code: 'MILK', lotRequired: true, expiryRequired: true }],
  ['rice', { code: 'RICE' }],
]);
const today = new Date('2026-09-19T00:00:00Z');

test('a receipt needs lot and expiry where the item demands them, and refuses an expired sellable lot', () => {
  const base = { orderNumber: 'PO-9', lines, items, today };
  const noLot = planPoReceipt({ ...base, receipt: [{ lineId: 'l1', receivedQty: 5 }] });
  assert.match(message(noLot), /lot number/);
  const noExpiry = planPoReceipt({ ...base, receipt: [{ lineId: 'l1', receivedQty: 5, lotNo: 'B1' }] });
  assert.match(message(noExpiry), /expiry date/);
  const expired = planPoReceipt({ ...base, receipt: [{ lineId: 'l1', receivedQty: 5, lotNo: 'B1', expiryDate: '2026-09-01' }] });
  assert.match(message(expired), /already expired/);
  const good = planPoReceipt({ ...base, receipt: [{ lineId: 'l1', receivedQty: 5, lotNo: 'B1', expiryDate: '2027-01-31' }] });
  assert.equal(good.ok && good.postings[0].lotNo, 'B1');
  assert.equal(good.ok && good.postings[0].expiryDate, '2027-01-31');
});

test('damaged goods count against the order but are never sellable; excess is separate', () => {
  const plan = planPoReceipt({ orderNumber: 'PO-9', lines, items, today, receipt: [
    { lineId: 'l1', receivedQty: 6, damagedQty: 2, lotNo: 'B1', expiryDate: '2027-01-31' },
    { lineId: 'l2', receivedQty: 3, excessQty: 1 },
  ] });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.postings.map((row) => [row.lineId, row.goodQty, row.damagedQty, row.excessQty, row.arrivedQty]), [['l1', 6, 2, 0, 8], ['l2', 3, 0, 1, 3]]);
  assert.equal(plan.postings[1].lotNo, 'PO-PO-9', 'a plain item lands in the order lot');
  assert.equal(statusAfterReceipt(lines, plan.postings), 'PARTIALLY_RECEIVED');
});

test('receiving more than is open is refused unless it is declared as excess', () => {
  const over = planPoReceipt({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'l2', receivedQty: 4 }] });
  assert.match(message(over), /Only 3 is still open/);
  const dupe = planPoReceipt({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'l2', receivedQty: 1 }, { lineId: 'l2', receivedQty: 1 }] });
  assert.equal(dupe.ok, false);
  assert.equal(planPoReceipt({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'nope', receivedQty: 1 }] }).ok, false);
  assert.equal(planPoReceipt({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'l1', receivedQty: 0 }] }).ok, false);
  assert.equal(planPoReceipt({ orderNumber: 'PO-9', lines, items, today, receipt: [{ lineId: 'l1', receivedQty: -1 }] }).ok, false);
});

test('the order completes only when every line has fully arrived', () => {
  const finishing = planPoReceipt({ orderNumber: 'PO-9', lines, items, today, receipt: [
    { lineId: 'l1', receivedQty: 10, lotNo: 'B1', expiryDate: '2027-01-31' }, { lineId: 'l2', receivedQty: 2, damagedQty: 1 },
  ] });
  assert.equal(finishing.ok && statusAfterReceipt(lines, finishing.postings), 'RECEIVED');
});

// ---- planning -------------------------------------------------------------

const supplier = { id: 's1', name: 'Fresh Foods', leadTimeDays: 4, moq: 24, status: 'ACTIVE' };

test('planning counts open orders and stock in transit before recommending, and explains itself', () => {
  const result = planPurchases({
    suppliers: [supplier],
    items: [
      { itemId: 'a', code: 'A', onHand: 4, minQty: 10, targetQty: 40, openPoQty: 0, inTransitQty: 0, supplierId: 's1' },
      { itemId: 'b', code: 'B', onHand: 4, minQty: 10, targetQty: 40, openPoQty: 30, inTransitQty: 0, supplierId: 's1' },
      { itemId: 'c', code: 'C', onHand: 4, minQty: 10, targetQty: 40, openPoQty: 0, inTransitQty: 20, supplierId: 's1' },
    ],
  });
  assert.deepEqual(result.suggestions.map((row) => [row.itemId, row.quantity]), [['a', 36]]);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0].reason, /covered/);
  const [a] = result.suggestions;
  assert.equal(a.urgency, 'HIGH');
  assert.equal(a.confidence, 'LOW', 'no sales history');
  assert.ok(a.explanation.length >= 4);
  assert.match(a.explanation[0], /Position 4 = 4 available/);
});

test('demand over the lead time raises the reorder point, and confidence follows the data window', () => {
  const [row] = planPurchases({
    suppliers: [supplier],
    items: [{ itemId: 'a', code: 'A', onHand: 30, minQty: 5, targetQty: 20, openPoQty: 0, inTransitQty: 0, avgDailyDemand: 6, demandDays: 30, supplierId: 's1' }],
  }).suggestions;
  // lead 4 days * 6/day = 24, + 5 minimum = reorder point 29; position 30 is above it? 30 > 29, so covered.
  assert.equal(row, undefined);
  const [needed] = planPurchases({
    suppliers: [supplier],
    items: [{ itemId: 'a', code: 'A', onHand: 20, minQty: 5, targetQty: 20, openPoQty: 0, inTransitQty: 0, avgDailyDemand: 6, demandDays: 30, supplierId: 's1' }],
  }).suggestions;
  assert.equal(needed.reorderPoint, 29);
  assert.equal(needed.orderUpTo, 71, 'reorder point 29 + 7 days of cover (42)');
  assert.equal(needed.quantity, 51);
  assert.equal(needed.confidence, 'HIGH');
  assert.equal(needed.daysOfCover, 3.333);
});

test('the supplier minimum order lifts a small need, reserved stock is not available, and a blocked supplier is flagged', () => {
  const [small] = planPurchases({ suppliers: [supplier], items: [{ itemId: 'a', onHand: 8, minQty: 10, targetQty: 12, openPoQty: 0, inTransitQty: 0, supplierId: 's1' }] }).suggestions;
  assert.equal(small.quantity, 24);
  assert.match(small.explanation.join(' '), /supplier minimum order of 24/);
  const [reserved] = planPurchases({ suppliers: [], items: [{ itemId: 'a', onHand: 12, reserved: 8, minQty: 5, targetQty: 20, openPoQty: 0, inTransitQty: 0 }] }).suggestions;
  assert.equal(reserved.position, 4);
  assert.equal(reserved.supplierId, null);
  const blocked = planPurchases({ suppliers: [{ ...supplier, status: 'BLOCKED' }], items: [{ itemId: 'a', code: 'A', onHand: 1, minQty: 5, targetQty: 20, openPoQty: 0, inTransitQty: 0, supplierId: 's1' }] });
  assert.equal(blocked.suggestions[0].supplierId, null);
  assert.match(blocked.skipped[0].reason, /blocked/);
});

test('an item with neither a rule nor sales is not guessed at; suggestions are grouped per supplier, worst first', () => {
  const none = planPurchases({ suppliers: [], items: [{ itemId: 'a', code: 'A', onHand: 0, minQty: 0, targetQty: 0, openPoQty: 0, inTransitQty: 0 }] });
  assert.equal(none.suggestions.length, 0);
  assert.match(none.skipped[0].reason, /no reorder rule/);

  const plan = planPurchases({
    suppliers: [supplier, { id: 's2', name: 'Grains Co' }],
    items: [
      { itemId: 'a', code: 'A', onHand: 5, minQty: 10, targetQty: 40, openPoQty: 0, inTransitQty: 0, supplierId: 's1', unitCost: 2 },
      { itemId: 'b', code: 'B', onHand: 0, minQty: 10, targetQty: 30, openPoQty: 0, inTransitQty: 0, supplierId: 's2', unitCost: 3 },
      { itemId: 'c', code: 'C', onHand: 2, minQty: 10, targetQty: 30, openPoQty: 0, inTransitQty: 0, supplierId: 's1', unitCost: 1 },
    ],
  });
  assert.equal(plan.suggestions[0].itemId, 'b', 'zero stock is critical and comes first');
  const groups = groupBySupplier(plan.suggestions);
  assert.deepEqual(groups.map((group) => [group.supplierId, group.lines.length]), [['s2', 1], ['s1', 2]]);
  assert.equal(groups[0].estimatedTotal, 90);
});

// Audit O-3: measured supplier lead time and its variability feed the plan.
import { planPurchases as planWithLeadTime, MIN_LEAD_TIME_SAMPLES } from './po-planning.js';
import { supplierLeadTimeStats } from './vendor-score.js';

const leadInput = { itemId: 'i1', onHand: 10, minQty: 5, targetQty: 0, openPoQty: 0, inTransitQty: 0, avgDailyDemand: 4, demandDays: 30, supplierId: 's1' };

test('lead time statistics come from placed -> last receipt, not from the draft date', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();
  const stats = supplierLeadTimeStats([
    { createdAt: day(0), orderedAt: day(5), completedAt: day(12) },   // 7 days from placement (12 from the draft)
    { createdAt: day(20), orderedAt: day(21), completedAt: day(30) }, // 9
    { createdAt: day(40), orderedAt: day(40), completedAt: day(51) }, // 11
    { createdAt: day(60), orderedAt: day(60), completedAt: null },    // still open: ignored
  ]);
  assert.equal(stats.samples, 3);
  assert.equal(stats.meanDays, 9);
  assert.equal(stats.stdDevDays, 2);
});

test('with no contractual lead time the plan uses the measured one and says so; too few samples fall back to the default', () => {
  const measured = { samples: MIN_LEAD_TIME_SAMPLES, meanDays: 10, stdDevDays: 0 };
  const plan = planWithLeadTime({ items: [leadInput], suppliers: [{ id: 's1', name: 'S', measured }] });
  assert.equal(plan.suggestions[0].leadTimeDays, 10);
  assert.match(plan.suggestions[0].explanation.join(' '), /measured over 3 completed orders/);
  const sparse = planWithLeadTime({ items: [leadInput], suppliers: [{ id: 's1', name: 'S', measured: { samples: 2, meanDays: 30, stdDevDays: 1 } }] });
  assert.equal(sparse.suggestions[0].leadTimeDays, 7);
});

test('a supplier whose lead time varies raises the safety stock above the configured minimum', () => {
  const steady = planWithLeadTime({ items: [leadInput], suppliers: [{ id: 's1', name: 'S', measured: { samples: 6, meanDays: 7, stdDevDays: 0 } }] }).suggestions[0];
  const erratic = planWithLeadTime({ items: [leadInput], suppliers: [{ id: 's1', name: 'S', measured: { samples: 6, meanDays: 7, stdDevDays: 3 } }] }).suggestions[0];
  assert.ok(erratic.reorderPoint > steady.reorderPoint);
  assert.match(erratic.explanation.join(' '), /varies by/);
  // A contractual lead time wins over the measured mean.
  const contract = planWithLeadTime({ items: [leadInput], suppliers: [{ id: 's1', name: 'S', leadTimeDays: 3, measured: { samples: 6, meanDays: 20, stdDevDays: 0 } }] }).suggestions[0];
  assert.equal(contract.leadTimeDays, 3);
});

test('case packs round the order up and EOQ raises small orders only when its cost inputs are given (audit O-4)', async () => {
  const { planPurchases, economicOrderQuantity } = await import('./po-planning.js');
  const base = { itemId: 'i', code: 'I', onHand: 0, minQty: 10, targetQty: 25, openPoQty: 0, inTransitQty: 0, avgDailyDemand: 4, demandDays: 30, unitCost: 10 };
  assert.equal(planPurchases({ items: [{ ...base, orderMultiple: 12 }], suppliers: [] }).suggestions[0].quantity, 72, '66 rounds up to 6 packs of 12');
  assert.equal(planPurchases({ items: [base], suppliers: [] }).suggestions[0].quantity, 66, 'no EOQ without cost inputs');
  // EOQ = sqrt(2 x 1460 x 50 / (0.2 x 10)) = 270.2
  assert.equal(Math.round(economicOrderQuantity({ dailyDemand: 4, unitCost: 10, orderingCost: 50, holdingRate: 0.2 })!), 270);
  assert.equal(economicOrderQuantity({ dailyDemand: 4, unitCost: 10 }), null);
  assert.equal(planPurchases({ items: [base], suppliers: [], orderingCost: 50, holdingRate: 0.2 }).suggestions[0].quantity, 271);
});
