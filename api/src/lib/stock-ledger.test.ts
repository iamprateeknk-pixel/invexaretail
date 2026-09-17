import test from 'node:test';
import assert from 'node:assert/strict';
import { StockLedger, NegativeStockBlockedError } from './stock-ledger.js';

test('posting a movement updates balance and records before/after', () => {
  const ledger = new StockLedger();
  const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };

  const movement = ledger.postMovement({
    ...key,
    movementType: 'OPENING_STOCK',
    qtyDelta: 50,
    actor: 'admin',
  });

  assert.equal(movement.beforeBalance, 0);
  assert.equal(movement.afterBalance, 50);
  assert.equal(ledger.getBalance(key).onHand, 50);
});

test('current stock equals sum of posted movements', () => {
  const ledger = new StockLedger();
  const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };

  ledger.postMovement({ ...key, movementType: 'OPENING_STOCK', qtyDelta: 100, actor: 'admin' });
  ledger.postMovement({ ...key, movementType: 'SALES_DEDUCTION', qtyDelta: -30, actor: 'sync' });
  ledger.postMovement({ ...key, movementType: 'PURCHASE_RECEIPT', qtyDelta: 20, actor: 'sync' });

  assert.equal(ledger.getBalance(key).onHand, 90);
  assert.equal(ledger.recomputeBalanceFromMovements(key), 90);
});

test('negative stock is blocked by default policy', () => {
  const ledger = new StockLedger();
  const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
  ledger.postMovement({ ...key, movementType: 'OPENING_STOCK', qtyDelta: 10, actor: 'admin' });

  assert.throws(
    () =>
      ledger.postMovement({
        ...key,
        movementType: 'SALES_DEDUCTION',
        qtyDelta: -15,
        actor: 'sync',
      }),
    NegativeStockBlockedError,
  );
  // Balance is unchanged after the blocked attempt.
  assert.equal(ledger.getBalance(key).onHand, 10);
});

test('ALLOW policy permits negative stock through', () => {
  const ledger = new StockLedger();
  const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
  ledger.postMovement({ ...key, movementType: 'OPENING_STOCK', qtyDelta: 5, actor: 'admin' });

  const movement = ledger.postMovement({
    ...key,
    movementType: 'SALES_DEDUCTION',
    qtyDelta: -8,
    actor: 'sync',
    negativeStockPolicy: 'ALLOW',
  });

  assert.equal(movement.afterBalance, -3);
  assert.equal(ledger.getBalance(key).onHand, -3);
});

test('posted movements are never mutated; corrections use reversal + replacement', () => {
  const ledger = new StockLedger();
  const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
  const original = ledger.postMovement({
    ...key,
    movementType: 'ADJUSTMENT',
    qtyDelta: 40,
    actor: 'admin',
  });

  const reversal = ledger.reverseMovement(original.id, 'admin', 'Wrong quantity entered');

  assert.equal(reversal.qtyDelta, -40);
  assert.equal(reversal.reversalOfId, original.id);
  assert.equal(ledger.getBalance(key).onHand, 0);

  // The original record persists unchanged apart from carrying the reversal link.
  const [storedOriginal] = ledger.listMovements(key);
  assert.equal(storedOriginal.qtyDelta, 40);
  assert.equal(storedOriginal.reversedById, reversal.id);

  // A movement cannot be reversed twice.
  assert.throws(() => ledger.reverseMovement(original.id, 'admin', 'again'));
});

test('every movement stores source document, actor, timestamp and correlation id', () => {
  const ledger = new StockLedger();
  const movement = ledger.postMovement({
    itemId: 'item-1',
    lotId: 'lot-1',
    locationId: 'loc-1',
    movementType: 'TRANSFER_IN',
    qtyDelta: 12,
    actor: 'picker-1',
    sourceDocument: 'TRANSFER-0042',
    sourceLineId: 'line-1',
    correlationId: 'corr-abc',
  });

  assert.equal(movement.sourceDocument, 'TRANSFER-0042');
  assert.equal(movement.sourceLineId, 'line-1');
  assert.equal(movement.actor, 'picker-1');
  assert.equal(movement.correlationId, 'corr-abc');
  assert.ok(movement.timestamp);
});

test('reserve and release move quantity between available and reserved without touching on-hand', () => {
  const ledger = new StockLedger();
  const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1' };
  ledger.postMovement({ ...key, movementType: 'OPENING_STOCK', qtyDelta: 25, actor: 'admin' });

  const afterReserve = ledger.reserve(key, 10);
  assert.equal(afterReserve.onHand, 25);
  assert.equal(afterReserve.reserved, 10);
  assert.equal(afterReserve.available, 15);

  assert.throws(() => ledger.reserve(key, 20));

  const afterRelease = ledger.releaseReservation(key, 4);
  assert.equal(afterRelease.reserved, 6);
  assert.equal(afterRelease.available, 19);
});

test('different lots at the same location are tracked as separate balances', () => {
  const ledger = new StockLedger();
  ledger.postMovement({
    itemId: 'item-1',
    lotId: 'lot-A',
    locationId: 'loc-1',
    movementType: 'OPENING_STOCK',
    qtyDelta: 20,
    actor: 'admin',
  });
  ledger.postMovement({
    itemId: 'item-1',
    lotId: 'lot-B',
    locationId: 'loc-1',
    movementType: 'OPENING_STOCK',
    qtyDelta: 40,
    actor: 'admin',
  });

  assert.equal(ledger.getBalance({ itemId: 'item-1', lotId: 'lot-A', locationId: 'loc-1' }).onHand, 20);
  assert.equal(ledger.getBalance({ itemId: 'item-1', lotId: 'lot-B', locationId: 'loc-1' }).onHand, 40);
});

test('different bins at the same location are tracked as separate balances and still sum at location level', () => {
  const ledger = new StockLedger();
  const base = { itemId: 'item-1', lotId: 'lot-1', locationId: 'wh-1' };
  ledger.postMovement({ ...base, binId: 'A-01', movementType: 'TRANSFER_IN', qtyDelta: 8, actor: 'picker' });
  ledger.postMovement({ ...base, binId: 'B-02', movementType: 'TRANSFER_IN', qtyDelta: 5, actor: 'picker' });
  assert.equal(ledger.getBalance({ ...base, binId: 'A-01' }).onHand, 8);
  assert.equal(ledger.getBalance({ ...base, binId: 'B-02' }).onHand, 5);
  assert.equal(ledger.getLocationOnHand('item-1', 'lot-1', 'wh-1'), 13);
});
