import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateDispatchAndDelivery, channelSafetyBufferHours, PICK_PACK_LEAD_HOURS } from './promise-engine.js';

test('a marketplace channel gets a larger safety buffer than the website', () => {
  assert.ok(channelSafetyBufferHours('AMAZON') > channelSafetyBufferHours('WEBSITE'));
  assert.ok(channelSafetyBufferHours('FLIPKART') > channelSafetyBufferHours('WEBSITE'));
});

test('an unknown channel falls back to the default buffer, not zero', () => {
  assert.equal(channelSafetyBufferHours('SOME_NEW_CHANNEL'), channelSafetyBufferHours('DEFAULT'));
});

test('dispatch time = reservedAt + pick/pack lead + channel buffer', () => {
  const reservedAt = new Date('2026-09-16T00:00:00.000Z');
  const result = estimateDispatchAndDelivery({ reservedAt, deliverySlaHours: null, channel: 'WEBSITE' });
  const expectedHours = PICK_PACK_LEAD_HOURS + channelSafetyBufferHours('WEBSITE');
  assert.equal(result.estimatedDispatchAt, new Date(reservedAt.getTime() + expectedHours * 60 * 60 * 1000).toISOString());
  assert.equal(result.safetyBufferHours, channelSafetyBufferHours('WEBSITE'));
});

test('delivery time is dispatch + the location delivery SLA when known', () => {
  const reservedAt = new Date('2026-09-16T00:00:00.000Z');
  const result = estimateDispatchAndDelivery({ reservedAt, deliverySlaHours: 24, channel: 'WEBSITE' });
  const dispatch = new Date(result.estimatedDispatchAt);
  assert.equal(result.estimatedDeliveryAt, new Date(dispatch.getTime() + 24 * 60 * 60 * 1000).toISOString());
});

test('an unknown delivery SLA yields no delivery estimate rather than fabricating one', () => {
  const result = estimateDispatchAndDelivery({ reservedAt: new Date(), deliverySlaHours: null, channel: 'WEBSITE' });
  assert.equal(result.estimatedDeliveryAt, null);
});

test('a marketplace order dispatches later than the same order placed on the website', () => {
  const reservedAt = new Date('2026-09-16T00:00:00.000Z');
  const website = estimateDispatchAndDelivery({ reservedAt, deliverySlaHours: 24, channel: 'WEBSITE' });
  const amazon = estimateDispatchAndDelivery({ reservedAt, deliverySlaHours: 24, channel: 'AMAZON' });
  assert.ok(new Date(amazon.estimatedDispatchAt).getTime() > new Date(website.estimatedDispatchAt).getTime());
});
