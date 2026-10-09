import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import ExpiryBoard from './ExpiryBoard.jsx';

test.afterEach(() => cleanup());

const lot = {
  id: 'lot-1', itemId: 'item-1', itemCode: 'SKU-1', itemName: 'Rice 5kg', category: 'Staples', subcategory: '', company: '', unit: 'KG',
  lotId: 'l1', lotNo: 'L-9', lotStatus: 'AVAILABLE', locationId: 'loc', quantity: 40,
  expiryDate: '2027-01-01T00:00:00.000Z', daysUntilExpiry: 21, horizon: 'WARNING', recommendedAction: 'Discount', purchaseValue: 800, saleValue: 1000,
};
const summary = { expiredLots: 0, expiredQty: 0, criticalLots: 0, warningLots: 1, warningQty: 40, upcomingLots: 0, upcomingQty: 0, datedLots: 0, missingLots: 0, missingQty: 0, atRiskLots: 1, atRiskQty: 40, atRiskValue: 800, datedOnHandLots: 1 };

function headers() {
  return [...document.querySelectorAll('table thead th')].map((th) => th.textContent.trim());
}

test('the lots table renders the default columns when none are configured', () => {
  render(React.createElement(ExpiryBoard, { lots: [lot], summary, categories: [], locationName: 'Main', role: 'ADMIN' }));
  assert.deepEqual(headers(), ['Item / lot', 'Qty', 'Expiry', 'Risk', 'Recommended action', 'Open']);
});

test('the lots table follows configured order, names, formulas and item fields', () => {
  const columns = [
    { key: 'item_lot', label: 'Product', source: 'core' },
    { key: 'calc_weeks', label: 'Weeks left', source: 'formula', formula: 'round(days_to_expiry / 7, 1)', type: 'number' },
    { key: 'field_rack', label: 'Rack', source: 'itemField', itemField: 'Shelf Rack' },
    { key: 'quantity', label: 'Units', source: 'core' },
    { key: 'open', label: 'Open', source: 'core' },
  ];
  render(React.createElement(ExpiryBoard, {
    lots: [lot], summary, categories: [], locationName: 'Main', role: 'ADMIN', columns, itemFieldValues: { 'item-1': { 'Shelf Rack': 'R-7' } },
  }));
  assert.deepEqual(headers(), ['Product', 'Weeks left', 'Rack', 'Units', 'Open']);
  const cells = [...document.querySelectorAll('table tbody tr:first-child td')].map((td) => td.textContent.trim());
  assert.match(cells[0], /Rice 5kg/);
  assert.equal(cells[1], '3');
  assert.equal(cells[2], 'R-7');
  assert.match(cells[3], /^40/);
  assert.equal(cells[4], 'Open');
});

test('a lot without an expiry date shows a dash in a days-to-expiry formula column', () => {
  const columns = [
    { key: 'item_lot', label: 'Item', source: 'core' },
    { key: 'calc_days', label: 'Days', source: 'formula', formula: 'days_to_expiry + 1', type: 'number' },
    { key: 'open', label: 'Open', source: 'core' },
  ];
  render(React.createElement(ExpiryBoard, { lots: [{ ...lot, daysUntilExpiry: null, expiryDate: null, horizon: 'MISSING' }], summary, categories: [], locationName: 'Main', role: 'ADMIN', columns }));
  assert.equal([...document.querySelectorAll('table tbody tr:first-child td')][1].textContent.trim(), '—');
});
