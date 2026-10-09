import { displayCountPriority } from './count-review.js';
import { formatDateTime } from './workspace.js';

export function mapPickerTasks(tasks, items) {
  return (tasks ?? []).map((task) => ({
    id: task.transferId,
    transferId: task.transferId,
    locationId: task.locationId,
    line: (task.lines ?? []).map((line) => `${items.find((item) => item.id === line.itemId)?.name ?? line.itemId} / ${line.lotId}`).join(', '),
    qty: (task.lines ?? []).reduce((total, line) => total + line.quantity, 0),
    status: task.status,
    assignedToMe: Boolean(task.assignedToMe),
  }));
}

export function toggleAssignedLocationIds(assignedLocationIds, locationId) {
  const current = assignedLocationIds ?? [];
  return current.includes(locationId)
    ? current.filter((id) => id !== locationId)
    : [...current, locationId];
}

export function sanitizeStockRowsForRole(rows, role) {
  if (role !== 'STORE_USER') return rows;
  return rows.map((row) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    physicalQuantity: row.physicalQuantity,
  }));
}

export function buildLowStockRows(stockRows, reorderRules) {
  return (stockRows ?? []).filter((row) => {
    const rule = (reorderRules ?? []).find((entry) => entry.itemId === row.itemId);
    return Boolean(rule) && Number(row.physicalQuantity ?? 0) <= Number(rule.minQty);
  });
}

export function buildCountTaskQueues({
  filteredCounts,
  assignments,
  locationId,
  items,
  locations,
  storeUsers,
  clock,
  countStatusFilter = 'all',
  searchTerm = '',
}) {
  const submittedCountTasks = (filteredCounts ?? []).map((count) => {
    const createdAt = count.createdAt ?? count.assignedAt ?? null;
    const dueAt = count.dueAt ?? count.dueDate ?? null;
    const actionable = !['Approved', 'Rejected', 'Cancelled', 'Completed', 'Recount'].includes(count.status);
    const overdue = actionable && Boolean(dueAt) && new Date(dueAt).getTime() < clock;
    return {
      ...count,
      createdAt,
      assignedAt: count.assignedAt ?? createdAt,
      pendingSince: count.pendingSince ?? count.assignedAt ?? createdAt,
      dueAt,
      progress: count.progress ?? (['Approved', 'Rejected'].includes(count.status) ? 100 : count.physicalQuantity !== undefined ? 75 : 0),
      priority: displayCountPriority(count.priority, overdue),
      overdue,
      locationName: count.locationName ?? locations.find((location) => location.id === count.locationId)?.name ?? count.locationId,
      assignedToName: count.assignedToName ?? count.user ?? 'Unassigned',
    };
  });
  const assignedCountTasks = (assignments ?? [])
    .filter((assignment) => assignment.locationId === locationId && assignment.status === 'ASSIGNED')
    .map((assignment) => {
      const dueAt = assignment.dueDate ?? assignment.countDate ?? null;
      const overdue = Boolean(dueAt) && new Date(dueAt).getTime() < clock;
      const relatedCounts = (filteredCounts ?? []).filter((count) =>
        count.itemId === assignment.itemId
        && count.locationId === assignment.locationId
        && count.submittedBy === assignment.assignedToId,
      );
      // A submitted count owns its review state; the assignment remains open only as work in progress.
      const taskStatus = relatedCounts.length ? 'In progress' : 'Assigned';
      return {
        ...assignment,
        assignmentId: assignment.id,
        item: assignment.itemName ?? items.find((item) => item.id === assignment.itemId)?.name ?? assignment.itemId,
        lot: 'All lots',
        locationName: locations.find((location) => location.id === assignment.locationId)?.name ?? assignment.locationId,
        assignedToName: assignment.assignedToName ?? storeUsers.find((user) => user.id === assignment.assignedToId)?.name ?? assignment.assignedToId,
        assignedAt: assignment.createdAt,
        pendingSince: assignment.createdAt,
        dueAt,
        progress: relatedCounts.length ? Math.min(95, Math.max(10, relatedCounts.filter((count) => ['APPROVED', 'REJECTED', 'RECOUNT'].includes(String(count.status).toUpperCase())).length * 25)) : 0,
        priority: displayCountPriority(assignment.priority, overdue),
        overdue,
        status: taskStatus,
      };
    })
    ;
  const allCountTaskRows = [...assignedCountTasks, ...submittedCountTasks];
  const needle = String(searchTerm ?? '').trim().toLowerCase();
  const countTaskRows = allCountTaskRows.filter((task) => {
    const matchesStatus = countStatusFilter === 'all'
      || (countStatusFilter === 'pending'
        ? ['assigned', 'pending review'].includes(String(task.status).toLowerCase())
        : countStatusFilter === 'overdue'
          ? task.overdue
          : String(task.status).toLowerCase().includes(countStatusFilter));
    const matchesSearch = !needle || [task.item, task.id, task.lot, task.locationName, task.assignedToName]
      .some((value) => String(value ?? '').toLowerCase().includes(needle));
    return matchesStatus && matchesSearch;
  });
  const pendingCountTasks = allCountTaskRows.filter((task) => ['assigned', 'pending review'].includes(String(task.status).toLowerCase()));
  const pendingApprovals = submittedCountTasks.filter((task) => String(task.status).toLowerCase().includes('pending'));
  return { submittedCountTasks, assignedCountTasks, allCountTaskRows, countTaskRows, pendingCountTasks, pendingApprovals };
}

export function buildReportRows({
  reportType,
  visibleRows,
  items,
  lowStockRows,
  locationId,
  reorderRules,
  filteredTransfers,
  varianceReport,
  expiryBoard,
  auditEvents,
}) {
  const reportRowsByType = {
    inventory: (visibleRows ?? []).map((row) => ({
      Item: row.itemName,
      SKU: items.find((item) => item.id === row.itemId)?.code ?? row.itemId,
      Physical: row.physicalQuantity ?? 0,
      Book: row.bookQuantity ?? 0,
      Variance: row.variance ?? 0,
    })),
    'low-stock': (lowStockRows ?? []).filter((row) => row.locationId === locationId).map((row) => {
      const rule = (reorderRules ?? []).find((entry) => entry.itemId === row.itemId);
      return { Item: row.itemName, OnHand: row.physicalQuantity ?? 0, Minimum: rule?.minQty ?? 0, Target: rule?.targetQty ?? 0, SuggestedOrder: Math.max(0, Number(rule?.targetQty ?? 0) - Number(row.physicalQuantity ?? 0)) };
    }),
    moves: (filteredTransfers ?? []).map((transfer) => ({ Transfer: transfer.id, Item: transfer.item, From: transfer.fromName, To: transfer.toName, Quantity: transfer.qty, Status: transfer.status })),
    variance: (varianceReport?.details ?? []).map((row) => ({ Item: row.itemName, Book: row.bookQuantity, Physical: row.physicalQuantity, Variance: row.variance, Status: row.status })),
    expiry: (expiryBoard?.lots ?? []).map((row) => ({ Item: row.itemName, Code: row.itemCode, Lot: row.lotNo, Qty: row.quantity, Expiry: row.expiryDate ? new Date(row.expiryDate).toLocaleDateString('en-IN') : 'Missing', DaysRemaining: row.daysUntilExpiry ?? 'No date', Horizon: row.horizon, Action: row.recommendedAction })),
    activity: (auditEvents ?? []).map((event) => ({ Action: event.name ?? event.action, Scope: event.scope ?? event.entityType, Record: event.entityId ?? '', Role: event.actorRole ?? '', Time: formatDateTime(event.createdAt) })),
  };
  return reportRowsByType[reportType] ?? [];
}

export function rowsToCsv(rows) {
  if (!rows?.length) return '';
  const columns = Object.keys(rows[0]);
  const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.map(escapeCell).join(','), ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(','))].join('\n');
}

export function filterCommandCatalog(items, query, limit = 9) {
  const needle = String(query ?? '').trim().toLowerCase();
  return (items ?? [])
    .filter((item) => !needle || `${item.label} ${item.description}`.toLowerCase().includes(needle))
    .slice(0, limit);
}
