import test from 'node:test';
import assert from 'node:assert/strict';
import { BinStockLedger, STAGING_BIN_ID } from './bin-stock.js';

test('BinStockLedger tracks live quantity per bin independently of other bins', () => {
  const ledger = new BinStockLedger();
  const loc = { itemId: 'item-1', lotId: 'lot-1', locationId: 'wh-1' };
  ledger.apply({ ...loc, binId: STAGING_BIN_ID }, 12);
  ledger.move({ ...loc, binId: STAGING_BIN_ID }, 'A-01', 8);
  assert.equal(ledger.get({ ...loc, binId: 'A-01' }).onHand, 8);
  assert.equal(ledger.get({ ...loc, binId: STAGING_BIN_ID }).onHand, 4);
  assert.equal(ledger.onHandInBin('wh-1', 'A-01', 'item-1'), 8);
});

test('BinStockLedger refuses to pick more than a bin actually holds', () => {
  const ledger = new BinStockLedger();
  const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'wh-1', binId: 'A-01' };
  ledger.apply(key, 3);
  assert.throws(() => ledger.apply(key, -4), /does not have/);
  assert.equal(ledger.get(key).onHand, 3);
});
