import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConnector,
  mapMarketplaceOrder,
  resetConnectors,
  validateNormalizedOrder,
  verifyConnectorSignature,
} from './connectors.js';
import { createHmac } from 'node:crypto';

test('mapMarketplaceOrder understands Amazon OrderItems + SellerSKU', () => {
  const mapped = mapMarketplaceOrder('AMAZON', {
    AmazonOrderId: 'AMZ-1001',
    BuyerName: 'Asha',
    OrderItems: [{ SellerSKU: 'SKU-1001', QuantityOrdered: 2 }, { SellerSKU: 'SKU-1001', QuantityOrdered: 1 }],
  });
  assert.equal(mapped.channel, 'AMAZON');
  assert.equal(mapped.externalReference, 'AMZ-1001');
  assert.deepEqual(mapped.lines, [{ sku: 'SKU-1001', quantity: 3 }]);
});

test('mapMarketplaceOrder understands Flipkart orderItems', () => {
  const mapped = mapMarketplaceOrder('FLIPKART', {
    orderId: 'FK-9',
    customerName: 'Ravi',
    orderItems: [{ sku: 'SKU-1002', quantity: 4 }],
  });
  assert.equal(mapped.channel, 'FLIPKART');
  assert.equal(mapped.externalReference, 'FK-9');
  assert.deepEqual(mapped.lines, [{ sku: 'SKU-1002', quantity: 4 }]);
});

test('mapMarketplaceOrder understands a first-party website payload', () => {
  const mapped = mapMarketplaceOrder('WEBSITE', {
    orderId: 'WEB-22',
    customerName: 'Site Customer',
    lines: [{ sku: 'SKU-1003', quantity: 1 }],
  });
  assert.equal(mapped.channel, 'WEBSTORE');
  assert.equal(validateNormalizedOrder(mapped), null);
});

test('validateNormalizedOrder rejects empty references and empty lines', () => {
  assert.ok(validateNormalizedOrder({ channel: 'AMAZON', externalReference: '', customerName: null, notes: null, lines: [{ sku: 'A', quantity: 1 }] }));
  assert.ok(validateNormalizedOrder({ channel: 'AMAZON', externalReference: 'X', customerName: null, notes: null, lines: [] }));
});

test('verifyConnectorSignature accepts a matching HMAC and rejects a mismatch', () => {
  resetConnectors();
  const connector = createConnector({ name: 'Amazon IN', platform: 'AMAZON', webhookSecret: 'top-secret', tenantId: 'default-company' });
  const body = '{"AmazonOrderId":"1"}';
  const signature = `sha256=${createHmac('sha256', connector.webhookSecret).update(body).digest('hex')}`;
  assert.equal(verifyConnectorSignature(connector.webhookSecret, body, signature), true);
  assert.equal(verifyConnectorSignature(connector.webhookSecret, body, 'sha256=deadbeef'), false);
});
