import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCountTaskQueues,
  buildLowStockRows,
  buildReportRows,
  filterCommandCatalog,
  mapPickerTasks,
  rowsToCsv,
  sanitizeStockRowsForRole,
  toggleAssignedLocationIds,
} from './workspace-queues.js';

test('picker tasks keep item names and summed quantities', () => {
  const tasks = mapPickerTasks([{
    transferId: 'tr-1',
    locationId: 'wh-1',
    status: 'PICKING',
    lines: [{ itemId: 'item-1', lotId: 'lot-1', quantity: 3 }, { itemId: 'item-1', lotId: 'lot-2', quantity: 2 }],
  }], [{ id: 'item-1', name: 'Rice 5kg' }]);
  assert.equal(tasks[0].qty, 5);
  assert.match(tasks[0].line, /Rice 5kg/);
});

test('assigned location toggles add and remove a branch', () => {
  assert.deepEqual(toggleAssignedLocationIds(['loc-1'], 'loc-2'), ['loc-1', 'loc-2']);
  assert.deepEqual(toggleAssignedLocationIds(['loc-1', 'loc-2'], 'loc-1'), ['loc-2']);
});

test('store users only see physical quantity on stock rows', () => {
  const rows = [{ itemId: 'item-1', itemName: 'Rice', physicalQuantity: 4, bookQuantity: 5 }];
  assert.deepEqual(sanitizeStockRowsForRole(rows, 'STORE_USER')[0], { itemId: 'item-1', itemName: 'Rice', physicalQuantity: 4 });
  assert.equal(sanitizeStockRowsForRole(rows, 'ADMIN')[0].bookQuantity, 5);
});

test('count queues mark overdue assigned work and keep pending review', () => {
  const queues = buildCountTaskQueues({
    filteredCounts: [{
      id: 'count-1',
            itemId: 'item-1',
      submittedBy: 'user-1',

      status: 'Pending review',
      locationId: 'loc-1',
      locationName: 'Main Store',
      user: 'Store User',
      createdAt: '2026-09-01T00:00:00.000Z',
    }],
    assignments: [{
      id: 'asg-1',
      locationId: 'loc-1',
      status: 'ASSIGNED',
      itemId: 'item-1',
      assignedToId: 'user-1',
      createdAt: '2026-09-01T00:00:00.000Z',
      dueDate: '2026-09-01T00:00:00.000Z',
      priority: 'NORMAL',
    }],
    locationId: 'loc-1',
    items: [{ id: 'item-1', name: 'Rice 5kg' }],
    locations: [{ id: 'loc-1', name: 'Main Store' }],
    storeUsers: [{ id: 'user-1', name: 'Asha' }],
    clock: Date.parse('2026-09-14T00:00:00.000Z'),
    countStatusFilter: 'all',
    searchTerm: '',
  });
  assert.equal(queues.assignedCountTasks[0].overdue, true);
  assert.equal(queues.assignedCountTasks[0].priority, 'Urgent');
  assert.equal(queues.pendingCountTasks.length, 1);
  assert.equal(queues.pendingApprovals[0].id, 'count-1');
});

test('approved lot count does not leave a duplicate pending assignment row', () => {
  const queues = buildCountTaskQueues({
    filteredCounts: [{ id: 'count-1', itemId: 'item-1', locationId: 'loc-1', submittedBy: 'user-1', status: 'APPROVED', createdAt: '2026-09-14T00:00:00.000Z' }],
    assignments: [{ id: 'assignment-1', itemId: 'item-1', locationId: 'loc-1', assignedToId: 'user-1', status: 'ASSIGNED', createdAt: '2026-09-13T00:00:00.000Z' }],
    locationId: 'loc-1',
    items: [{ id: 'item-1', name: 'Rice 5kg' }],
    locations: [{ id: 'loc-1', name: 'Main Store' }],
    storeUsers: [{ id: 'user-1', name: 'Asha' }],
    clock: Date.parse('2026-09-14T00:00:00.000Z'),
    countStatusFilter: 'all',
    searchTerm: '',
  });
  assert.equal(queues.assignedCountTasks[0].status, 'In progress');
  assert.equal(queues.pendingCountTasks.length, 0);
  assert.equal(queues.countTaskRows.filter((row) => String(row.status).toLowerCase().includes('pending')).length, 0);
});test('report rows and CSV keep inventory labels', () => {
  const rows = buildReportRows({
    reportType: 'inventory',
    visibleRows: [{ itemId: 'item-1', itemName: 'Rice 5kg', physicalQuantity: 4, bookQuantity: 5, variance: -1 }],
    items: [{ id: 'item-1', code: 'SKU-1001' }],
    lowStockRows: [],
    locationId: 'loc-1',
    reorderRules: [],
    filteredTransfers: [],
    varianceReport: null,
    expiryBoard: { lots: [] },
    auditEvents: [],
  });
  assert.deepEqual(rows[0], { Item: 'Rice 5kg', SKU: 'SKU-1001', Physical: 4, Book: 5, Variance: -1 });
  assert.match(rowsToCsv(rows), /"Item","SKU","Physical","Book","Variance"/);
  assert.equal(buildLowStockRows([{ itemId: 'item-1', physicalQuantity: 2 }], [{ itemId: 'item-1', minQty: 3 }]).length, 1);
});

test('command catalog filters on label and description', () => {
  const items = [
    { label: 'Create stock transfer', description: 'Request stock movement' },
    { label: 'Dashboard', description: 'Live work and risk' },
  ];
  assert.equal(filterCommandCatalog(items, 'transfer').length, 1);
  assert.equal(filterCommandCatalog(items, '').length, 2);
});
