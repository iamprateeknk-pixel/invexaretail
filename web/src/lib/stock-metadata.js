export const SYSTEM_STOCK_COLUMNS = new Set(['book', 'variance', 'quarantine', 'reserved', 'value']);

export function visibleStockColumns(page, { role, canViewSystemStock } = {}) {
  return (page?.columns ?? []).filter((column) => {
    if (column.visible === false) return false;
    if (Array.isArray(column.visibleRoles) && role && !column.visibleRoles.includes(role)) return false;
    if (!canViewSystemStock && SYSTEM_STOCK_COLUMNS.has(column.key)) return false;
    return true;
  });
}

export function isStockActionEnabled(page, key) {
  const action = page?.actions?.find((entry) => entry.key === key);
  return action ? action.enabled !== false : true;
}

export function stockActionIsAvailable(page, key, role) {
  if (!Array.isArray(page?.actions)) return true;
  const action = page.actions.find((entry) => entry.key === key);
  if (!action) return false;
  if (action.enabled === false) return false;
  if (Array.isArray(action.visibleRoles) && role && !action.visibleRoles.includes(role)) return false;
  return true;
}

export function customStockValues(row, columns) {
  return (columns ?? [])
    .filter((column) => column.source === 'custom')
    .map((column) => ({
      key: column.key,
      label: column.label,
      value: row?.fields?.[column.key] ?? column.defaultValue ?? row?.[column.key] ?? '—',
    }));
}
