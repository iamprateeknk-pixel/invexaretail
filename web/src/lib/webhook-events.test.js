import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayDeliveryStatus,
  displayWebhookEvent,
  formatWebhookEvents,
  WEBHOOK_EVENT_OPTIONS,
} from './webhook-events.js';

test('webhook event labels cover the live integration options', () => {
  assert.equal(WEBHOOK_EVENT_OPTIONS.length, 4);
  assert.equal(displayWebhookEvent('count.reviewed'), 'Count reviewed');
  assert.equal(displayWebhookEvent('stock.low'), 'Low stock');
  assert.equal(formatWebhookEvents(['transfer.updated', 'count.reviewed']), 'Transfer updated, Count reviewed');
  assert.equal(displayDeliveryStatus('DELIVERED'), 'Delivered');
  assert.equal(displayDeliveryStatus('FAILED'), 'Failed');
  assert.equal(displayDeliveryStatus('PENDING'), 'Pending');
});
