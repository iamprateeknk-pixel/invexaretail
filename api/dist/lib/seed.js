"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedTransfers = exports.seedCounts = exports.seedReorderRules = exports.seedStockLedger = exports.seedItems = exports.seedLocations = exports.seedUsers = void 0;
exports.seedUsers = [
    {
        id: 'user-admin-1',
        email: 'admin@retail.local',
        name: 'Admin User',
        role: 'ADMIN',
        assignedLocationIds: ['loc-1', 'loc-2', 'wh-1'],
    },
    {
        id: 'user-manager-1',
        email: 'manager@retail.local',
        name: 'Branch Manager',
        role: 'BRANCH_MANAGER',
        assignedLocationIds: ['loc-1'],
    },
    {
        id: 'user-store-1',
        email: 'store@retail.local',
        name: 'Store User',
        role: 'STORE_USER',
        assignedLocationIds: ['loc-1'],
    },
    {
        id: 'user-picker-1',
        email: 'picker@retail.local',
        name: 'Warehouse Picker',
        role: 'WAREHOUSE_PICKER',
        assignedLocationIds: ['wh-1'],
    },
    {
        id: 'user-auditor-1',
        email: 'auditor@retail.local',
        name: 'Auditor User',
        role: 'AUDITOR',
        assignedLocationIds: ['loc-1'],
    },
];
exports.seedLocations = [
    { id: 'loc-1', name: 'Main Store', type: 'store' },
    { id: 'loc-2', name: 'Branch Store', type: 'store' },
    { id: 'wh-1', name: 'Warehouse', type: 'warehouse' },
];
exports.seedItems = [
    {
        id: 'item-1001',
        code: 'SKU-1001',
        name: 'Rice 5kg',
        category: 'Staples',
        unit: 'bag',
        lots: [{ id: 'lot-1001', itemId: 'item-1001', lotNo: 'LOT-01', expiryDate: '2027-12-31', attributes: { source: 'seed' } }],
    },
    {
        id: 'item-1002',
        code: 'SKU-1002',
        name: 'Milk 1L',
        category: 'Dairy',
        unit: 'pack',
        lots: [{ id: 'lot-1002', itemId: 'item-1002', lotNo: 'LOT-02', expiryDate: '2026-12-15', attributes: { source: 'seed' } }],
    },
    {
        id: 'item-1003',
        code: 'SKU-1003',
        name: 'Soap 200g',
        category: 'Household',
        unit: 'box',
        lots: [{ id: 'lot-1003', itemId: 'item-1003', lotNo: 'LOT-03', expiryDate: '2027-03-15', attributes: { source: 'seed' } }],
    },
    {
        id: 'item-1004',
        code: 'SKU-1004',
        name: 'Yoghurt 500g',
        category: 'Dairy',
        unit: 'cup',
        lots: [{ id: 'lot-1004', itemId: 'item-1004', lotNo: 'LOT-EXP', expiryDate: '2026-09-01', attributes: { source: 'seed', purchaseValue: 180 } }],
    },
    {
        id: 'item-1005',
        code: 'SKU-1005',
        name: 'Bread 400g',
        category: 'Bakery',
        unit: 'loaf',
        lots: [{ id: 'lot-1005', itemId: 'item-1005', lotNo: 'LOT-SOON', expiryDate: '2026-09-18', attributes: { source: 'seed', purchaseValue: 90 } }],
    },
    {
        id: 'item-1006',
        code: 'SKU-1006',
        name: 'Flour 10kg',
        category: 'Staples',
        unit: 'bag',
        lots: [{ id: 'lot-1006', itemId: 'item-1006', lotNo: 'LOT-ND', expiryDate: null, attributes: { source: 'seed' } }],
    },
];
exports.seedStockLedger = [
    { itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', onHand: 28, quarantine: 0, version: 0 },
    { itemId: 'item-1001', lotId: 'lot-1001', locationId: 'wh-1', onHand: 40, quarantine: 0, version: 0 },
    { itemId: 'item-1002', lotId: 'lot-1002', locationId: 'loc-1', onHand: 26, quarantine: 0, version: 0 },
    { itemId: 'item-1002', lotId: 'lot-1002', locationId: 'loc-2', onHand: 26, quarantine: 0, version: 0 },
    { itemId: 'item-1003', lotId: 'lot-1003', locationId: 'wh-1', onHand: 80, quarantine: 0, version: 0 },
    { itemId: 'item-1004', lotId: 'lot-1004', locationId: 'loc-1', onHand: 6, quarantine: 0, version: 0 },
    { itemId: 'item-1005', lotId: 'lot-1005', locationId: 'loc-1', onHand: 10, quarantine: 0, version: 0 },
    { itemId: 'item-1006', lotId: 'lot-1006', locationId: 'loc-1', onHand: 12, quarantine: 0, version: 0 },
];
exports.seedReorderRules = [
    { id: 'reorder-1001-loc-1', itemId: 'item-1001', locationId: 'loc-1', minQty: 30, targetQty: 50 },
    { id: 'reorder-1006-loc-1', itemId: 'item-1006', locationId: 'loc-1', minQty: 20, targetQty: 40 },
];
exports.seedCounts = [
    {
        id: 'count-1',
        itemId: 'item-1001',
        lotId: 'lot-1001',
        locationId: 'loc-1',
        physicalQuantity: 28,
        bookQty: 28,
        mode: 'scan',
        submittedBy: 'user-store-1',
        role: 'STORE_USER',
        status: 'APPROVED',
        createdAt: new Date().toISOString(),
    },
    {
        id: 'count-2',
        itemId: 'item-1002',
        lotId: 'lot-1002',
        locationId: 'loc-2',
        physicalQuantity: 26,
        bookQty: 26,
        mode: 'manual',
        submittedBy: 'user-store-1',
        role: 'STORE_USER',
        status: 'APPROVED',
        createdAt: new Date().toISOString(),
    },
];
exports.seedTransfers = [
    {
        id: 'transfer-1',
        sourceLocationId: 'loc-1',
        destinationLocationId: 'wh-1',
        requestedBy: 'user-admin-1',
        role: 'ADMIN',
        status: 'REQUESTED',
        cartonCount: 2,
        lines: [{ itemId: 'item-1001', lotId: 'lot-1001', quantity: 12 }],
        createdAt: new Date().toISOString(),
    },
    {
        id: 'transfer-2',
        sourceLocationId: 'wh-1',
        destinationLocationId: 'loc-2',
        requestedBy: 'user-admin-1',
        role: 'ADMIN',
        status: 'DISPATCHED',
        cartonCount: 4,
        lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 18 }],
        createdAt: new Date().toISOString(),
    },
];
