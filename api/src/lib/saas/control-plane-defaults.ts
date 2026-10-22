import { STOCK_FORMULA_FIELDS } from '../formula.js';
import type { ColumnDefinition, PageDefinition, TableKey } from './control-plane.js';

export const DEFAULT_STOCK_PAGE: PageDefinition = {
  pageKey: 'inventory.stock',
  title: 'Stock by item',
  route: '/inventory',
  columns: [
    { key: 'item_code', label: 'Item code & name', type: 'text', source: 'core', visible: true, exportEnabled: true, mobileEnabled: true },
    { key: 'company', label: 'Company', type: 'text', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
    { key: 'category', label: 'Category', type: 'text', source: 'core', visible: true, exportEnabled: true, mobileEnabled: true },
    { key: 'pack_size', label: 'Pack/Size', type: 'text', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
    { key: 'lot_coverage', label: 'Lot coverage', type: 'text', source: 'core', visible: true, exportEnabled: false, mobileEnabled: true },
    { key: 'physical', label: 'Total physical', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: true },
    { key: 'book', label: 'Total book', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
    { key: 'variance', label: 'Variance', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
    { key: 'quarantine', label: 'Quarantine', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
    { key: 'reserved', label: 'Reserved', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
    { key: 'available', label: 'Available', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: true },
    { key: 'value', label: 'Value', type: 'currency', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
  ],
  actions: [
    { key: 'export', label: 'Export', enabled: true, placement: 'header', visibleRoles: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'] },
    { key: 'scan', label: 'Scan item', enabled: true, placement: 'header' },
    { key: 'daily_import', label: 'Daily sales / purchase', enabled: true, placement: 'header', visibleRoles: ['ADMIN', 'ADMIN_USER'] },
  ],
  widgets: [
    { key: 'stock_table', label: 'Stock table', order: 1 },
    { key: 'lots', label: 'Lots', order: 2 },
  ],
  tabs: [
    { key: 'stock', label: 'Stock', order: 1 },
    { key: 'lots', label: 'Lots', order: 2 },
    { key: 'movements', label: 'Movements', order: 3 },
  ],
};

export const MODULE_REGISTRY: Record<string, { name: string; dependencies: string[]; entitlementKey: string }> = {
  CATALOG: { name: 'Catalog', dependencies: [], entitlementKey: 'module.catalog' },
  LOCATIONS: { name: 'Locations', dependencies: [], entitlementKey: 'module.locations' },
  INVENTORY: { name: 'Inventory', dependencies: ['CATALOG', 'LOCATIONS'], entitlementKey: 'module.inventory' },
  WMS: { name: 'Warehouse', dependencies: ['INVENTORY'], entitlementKey: 'module.wms' },
  OMS: { name: 'Orders', dependencies: ['INVENTORY'], entitlementKey: 'module.oms' },
  PURCHASING: { name: 'Purchasing', dependencies: ['INVENTORY'], entitlementKey: 'module.purchasing' },
  ANALYTICS: { name: 'Analytics', dependencies: ['INVENTORY'], entitlementKey: 'module.analytics' },
  ADVANCED_WORKFLOW: { name: 'Advanced workflow', dependencies: ['INVENTORY'], entitlementKey: 'module.advanced_workflow' },
  INTEGRATIONS: { name: 'Integrations', dependencies: [], entitlementKey: 'module.integrations' },
  MOBILE_OFFLINE: { name: 'Mobile offline', dependencies: ['INVENTORY'], entitlementKey: 'module.mobile_offline' },
};

export const ACTION_REGISTRY: Record<string, { handlerKey: string; permission: string }> = {
  CREATE_TRANSFER: { handlerKey: 'transfers.create', permission: 'inventory.create' },
  APPROVE_TRANSFER: { handlerKey: 'transfers.approve', permission: 'inventory.approve' },
  POST_STOCK_ADJUSTMENT: { handlerKey: 'inventory.adjust', permission: 'inventory.adjust' },
  CREATE_PO: { handlerKey: 'purchasing.create', permission: 'purchasing.create' },
  BLOCK_LOT: { handlerKey: 'inventory.block_lot', permission: 'inventory.edit' },
  CREATE_TASK: { handlerKey: 'tasks.create', permission: 'inventory.create' },
  SEND_NOTIFICATION: { handlerKey: 'notify.send', permission: 'inventory.view' },
  CALL_WEBHOOK: { handlerKey: 'integrations.webhook', permission: 'integrations.edit' },
};

export const col = (key: string, label: string, type = 'text'): ColumnDefinition =>
  ({ key, label, type, source: 'core', visible: true, exportEnabled: true, mobileEnabled: true });

// The Lots & expiry table. `item_lot` and `open` (the row action) cannot be hidden.
export const DEFAULT_LOT_COLUMNS: ColumnDefinition[] = [
  col('item_lot', 'Item / lot'),
  col('quantity', 'Qty', 'number'),
  col('expiry', 'Expiry', 'date'),
  col('risk', 'Risk'),
  col('recommended_action', 'Recommended action'),
  col('open', 'Open'),
];

// The "Lot Details" list inside the item detail dialog. `lot_no` and `print` (the label button) cannot be hidden.
export const DEFAULT_ITEM_LOT_COLUMNS: ColumnDefinition[] = [
  col('lot_no', 'Lot'),
  col('expiry', 'Expires', 'date'),
  col('batch', 'Batch'),
  col('purchase_value', 'Purchase', 'currency'),
  col('sale_value', 'Sale', 'currency'),
  col('status', 'Status'),
  col('print', 'Print label'),
];

export const DEFAULT_TABLE_COLUMNS: Record<Exclude<TableKey, 'stock'>, ColumnDefinition[]> = {
  lots: DEFAULT_LOT_COLUMNS,
  itemLots: DEFAULT_ITEM_LOT_COLUMNS,
};

/** Per table: columns that must stay visible, built-in columns that may hold a formula, and the numbers a formula may use. */
export const TABLE_RULES: Record<TableKey, { locked: string[]; formulaFields: readonly string[]; overridable: string[] }> = {
  stock: { locked: ['item_code'], formulaFields: STOCK_FORMULA_FIELDS, overridable: ['available'] },
  lots: { locked: ['item_lot', 'open'], formulaFields: ['quantity', 'days_to_expiry', 'purchase_value', 'sale_value'], overridable: [] },
  itemLots: { locked: ['lot_no', 'print'], formulaFields: ['days_to_expiry', 'purchase_value', 'sale_value'], overridable: [] },
};

export const COLUMN_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'] as const;
