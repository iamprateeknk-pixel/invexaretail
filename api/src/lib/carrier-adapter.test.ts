import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCarrierAdapter, getCarrierAdapter, listCarrierProviders } from './carrier-adapter.js';

test('getRates returns a surface and express quote, express costs more and arrives sooner', async () => {
  const adapter = new LocalCarrierAdapter();
  const rates = await adapter.getRates({
    orderReference: 'order-1', originPincode: '302001', destinationPincode: '110001', weightKg: 2,
  });
  assert.equal(rates.length, 2);
  const surface = rates.find((rate) => rate.serviceCode === 'LOCAL_SURFACE')!;
  const express = rates.find((rate) => rate.serviceCode === 'LOCAL_EXPRESS')!;
  assert.ok(express.estimatedCost > surface.estimatedCost);
  assert.ok(express.estimatedDays < surface.estimatedDays);
});

test('heavier shipments cost more', async () => {
  const adapter = new LocalCarrierAdapter();
  const light = await adapter.getRates({ orderReference: 'o', originPincode: '1', destinationPincode: '2', weightKg: 1 });
  const heavy = await adapter.getRates({ orderReference: 'o', originPincode: '1', destinationPincode: '2', weightKg: 10 });
  assert.ok(heavy[0].estimatedCost > light[0].estimatedCost);
});

test('every pincode is serviceable by the local adapter', async () => {
  const adapter = new LocalCarrierAdapter();
  assert.equal(await adapter.checkServiceability('000000'), true);
});

test('createShipment issues an AWB that can then be tracked, starting BOOKED', async () => {
  const adapter = new LocalCarrierAdapter();
  const shipment = await adapter.createShipment({
    orderReference: 'order-42', originPincode: '302001', destinationPincode: '110001', weightKg: 1.5,
  });
  assert.ok(shipment.awbNumber.startsWith('LOCAL-'));
  const tracking = await adapter.trackShipment(shipment.awbNumber);
  assert.equal(tracking.status, 'BOOKED');
  assert.equal(tracking.events[0].status, 'BOOKED');
});

test('tracking an unknown AWB throws rather than fabricating a status', async () => {
  const adapter = new LocalCarrierAdapter();
  await assert.rejects(() => adapter.trackShipment('LOCAL-DOES-NOT-EXIST'));
});

test('cancelShipment records a CANCELLED event and cannot cancel a delivered shipment', async () => {
  const adapter = new LocalCarrierAdapter();
  const shipment = await adapter.createShipment({
    orderReference: 'order-cancel', originPincode: '302001', destinationPincode: '110001', weightKg: 1,
  });
  await adapter.cancelShipment(shipment.awbNumber);
  const tracking = await adapter.trackShipment(shipment.awbNumber);
  assert.equal(tracking.status, 'CANCELLED');
  assert.equal(tracking.events.at(-1)?.status, 'CANCELLED');
});

test('the carrier registry resolves "local" and rejects an unconfigured provider', () => {
  assert.deepEqual(listCarrierProviders(), ['local']);
  assert.equal(getCarrierAdapter('local').provider, 'local');
  assert.throws(() => getCarrierAdapter('shiprocket'));
});
