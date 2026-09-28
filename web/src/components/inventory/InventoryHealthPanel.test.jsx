import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { InventoryHealthPanel } from './InventoryHealthPanel.jsx';

test.afterEach(() => cleanup());

const health = {
  windowDays: 30, turns: 3.04, daysOfInventory: 120, gmroi: 5.11, unitsSoldUnpriced: 20, note: undefined,
  valuation: { totalValue: 1200, valuedUnits: 110, unvaluedUnits: 5, byCategory: [] },
  service: { orders: 4, orderFillRatePercent: 50, unitFillRatePercent: 60 },
  ageing: [{ bucket: '0-30', units: 10, value: 100 }, { bucket: '31-90', units: 0, value: 0 }, { bucket: '91-180', units: 0, value: 0 }, { bucket: '181+', units: 0, value: 0 }],
  items: [
    { itemId: 'r', code: 'RICE', name: 'Rice', onHand: 10, value: 200, unitsSold: 0, avgDailyDemand: 0, daysOfCover: null, status: 'DEAD' },
    { itemId: 'm', code: 'MILK', name: 'Milk', onHand: 100, value: 1000, unitsSold: 30, avgDailyDemand: 1, daysOfCover: 100, status: 'HEALTHY' },
  ],
};

test('shows valuation, fill rate and dead stock as readable text, with status spelled out rather than colour-coded', () => {
  render(React.createElement(InventoryHealthPanel, { health, accuracy: { accuracyPercent: 75, withinTolerance: 3, counts: 4, valueAccuracyPercent: 61.5, varianceValue: 1540, byClass: { A: { accuracyPercent: 50, counts: 2 } } }, reasons: [{ reasonCode: 'DAMAGE', counts: 2, absoluteUnits: 7, netUnits: -7 }, { reasonCode: 'UNCODED', counts: 1, absoluteUnits: 2, netUnits: 2 }] }));
  assert.ok(screen.getByText('Order fill rate'));
  assert.match(screen.getByText(/5 units have no recorded cost/).textContent, /not valued/);
  assert.ok(screen.getByText('GMROI (annualised)'));
  assert.match(screen.getByText(/20 units sold have no RETAIL price/).textContent, /excluded/);
  const dead = screen.getByRole('row', { name: /RICE/ });
  assert.match(dead.textContent, /Dead \(no sales\)/);
  assert.equal(screen.queryByRole('row', { name: /MILK/ }), null, 'healthy items are not listed as needing attention');
  assert.ok(screen.getByText(/Class A: 50% within tolerance/));
  assert.ok(screen.getByRole('rowheader', { name: 'No cause recorded' }));
  assert.ok(screen.getByRole('rowheader', { name: 'damage' }));
});

test('tables carry captions and column headers so a screen reader can navigate them', () => {
  render(React.createElement(InventoryHealthPanel, { health, reasons: [] }));
  assert.ok(screen.getAllByRole('table').length >= 2);
  assert.ok(screen.getByRole('columnheader', { name: 'Held for' }));
  assert.ok(screen.getByText('No variances in this period'));
});
