import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateRoutingScore,
  haversineKm,
  rankOrderCandidates,
  splitLinesAcrossLocations,
  type LocationCandidate,
  type LocationAvailability,
} from './order-routing.js';

test('rankOrderCandidates prefers store locations over warehouses when no geo/SLA/cost is present', () => {
  const ranked = rankOrderCandidates([
    { locationId: 'wh-1', locationName: 'H.O. Basni', locationType: 'warehouse' },
    { locationId: 'loc-2', locationName: 'Vaishali Nagar', locationType: 'store' },
    { locationId: 'loc-1', locationName: 'Gopalpura', locationType: 'store' },
  ]);
  assert.deepEqual(ranked.map((c) => c.locationId), ['loc-1', 'loc-2', 'wh-1']);
});

test('rankOrderCandidates is a pure sort - does not mutate the input array', () => {
  const input = [
    { locationId: 'wh-1', locationName: 'Warehouse', locationType: 'warehouse' },
    { locationId: 'loc-1', locationName: 'Store', locationType: 'store' },
  ];
  const original = [...input];
  rankOrderCandidates(input);
  assert.deepEqual(input, original);
});

test('haversineKm is zero for the same point and ~1.1km for nearby Jodhpur coordinates', () => {
  assert.equal(haversineKm(26.2389, 73.0243, 26.2389, 73.0243), 0);
  const nearby = haversineKm(26.2389, 73.0243, 26.2489, 73.0243);
  assert.ok(nearby > 1 && nearby < 1.3);
});

test('rankOrderCandidates prefers the closer store when customer coordinates are present', () => {
  const ranked = rankOrderCandidates(
    [
      { locationId: 'far', locationName: 'Far Store', locationType: 'store', latitude: 26.4, longitude: 73.1 },
      { locationId: 'near', locationName: 'Near Store', locationType: 'store', latitude: 26.24, longitude: 73.03 },
      { locationId: 'wh', locationName: 'Warehouse', locationType: 'warehouse', latitude: 27.0, longitude: 74.0 },
    ],
    { customerLatitude: 26.2389, customerLongitude: 73.0243 },
  );
  assert.equal(ranked[0].locationId, 'near');
});

test('candidateRoutingScore penalises high SLA, shipping cost and open-order workload', () => {
  const base: LocationCandidate = {
    locationId: 'a',
    locationName: 'A',
    locationType: 'store',
    latitude: 26.24,
    longitude: 73.03,
    deliverySlaHours: 4,
    shippingCostPerKm: 8,
    openOrderCount: 2,
  };
  const busy: LocationCandidate = { ...base, locationId: 'b', locationName: 'B', deliverySlaHours: 48, shippingCostPerKm: 40, openOrderCount: 30 };
  const ctx = { customerLatitude: 26.2389, customerLongitude: 73.0243 };
  assert.ok(candidateRoutingScore(base, ctx) < candidateRoutingScore(busy, ctx));
});

test('splitLinesAcrossLocations fills from ranked locations then reports remainder', () => {
  const availability: LocationAvailability = new Map([
    ['loc-1', new Map([['item-a', 4], ['item-b', 0]])],
    ['wh-1', new Map([['item-a', 10], ['item-b', 3]])],
  ]);
  const ranked: LocationCandidate[] = [
    { locationId: 'loc-1', locationName: 'Store', locationType: 'store' },
    { locationId: 'wh-1', locationName: 'Warehouse', locationType: 'warehouse' },
  ];
  const result = splitLinesAcrossLocations(
    [{ itemId: 'item-a', quantity: 6 }, { itemId: 'item-b', quantity: 5 }],
    ranked,
    availability,
  );
  assert.deepEqual(result.splits, [
    { locationId: 'loc-1', lines: [{ itemId: 'item-a', quantity: 4 }] },
    { locationId: 'wh-1', lines: [{ itemId: 'item-a', quantity: 2 }, { itemId: 'item-b', quantity: 3 }] },
  ]);
  assert.deepEqual(result.remainder, [{ itemId: 'item-b', quantity: 2 }]);
});

test('splitLinesAcrossLocations is a no-op when one location can fill everything', () => {
  const availability: LocationAvailability = new Map([
    ['loc-1', new Map([['item-a', 10]])],
    ['wh-1', new Map([['item-a', 10]])],
  ]);
  const ranked: LocationCandidate[] = [
    { locationId: 'loc-1', locationName: 'Store', locationType: 'store' },
    { locationId: 'wh-1', locationName: 'Warehouse', locationType: 'warehouse' },
  ];
  const result = splitLinesAcrossLocations([{ itemId: 'item-a', quantity: 3 }], ranked, availability);
  assert.deepEqual(result.splits, [{ locationId: 'loc-1', lines: [{ itemId: 'item-a', quantity: 3 }] }]);
  assert.deepEqual(result.remainder, []);
});
