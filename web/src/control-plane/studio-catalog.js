// Plain-language catalogues and converters for the Control Plane Studio editors.
// The server stores technical shapes (keys, condition objects, workflow graphs);
// these helpers turn them into something a store owner can read and back again,
// so the "Simple" view never shows a key or JSON while "Advanced" still can.

export const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'BRANCH_MANAGER', label: 'Branch manager' },
  { value: 'STORE_USER', label: 'Store user' },
  { value: 'WAREHOUSE_PICKER', label: 'Warehouse picker' },
  { value: 'AUDITOR', label: 'Auditor' },
];

export const ENTITY_OPTIONS = [
  { value: 'item', label: 'Item' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'order', label: 'Sales order' },
  { value: 'purchase_order', label: 'Purchase order' },
  { value: 'count', label: 'Stock count' },
  { value: 'stock', label: 'Stock row' },
];

export const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Pick from a list' },
  { value: 'boolean', label: 'Yes / No' },
];

export function labelOf(options, value) {
  return options.find((option) => option.value === value)?.label ?? String(value ?? '');
}

/** A technical key from a human name: "Shelf No." -> "shelf_no", unique against `taken`. */
export function slugKey(name, taken = []) {
  let base = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  if (!base) base = 'field';
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  const used = new Set(taken);
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

// ---- rules ------------------------------------------------------------------

export const RULE_FIELDS = [
  { value: 'daysToExpiry', label: 'Days left to expiry', type: 'number' },
  { value: 'adjustmentValue', label: 'Stock adjustment value (₹)', type: 'number' },
  { value: 'varianceQty', label: 'Count difference (qty)', type: 'number' },
  { value: 'transferValue', label: 'Transfer value (₹)', type: 'number' },
  { value: 'branchCity', label: 'Branch city', type: 'text' },
];

export const RULE_OPERATORS = [
  { value: 'eq', label: 'is' },
  { value: 'Gt', label: 'is more than' },
  { value: 'Gte', label: 'is at least' },
  { value: 'Lt', label: 'is less than' },
  { value: 'Lte', label: 'is at most' },
];

export const RULE_ACTIONS = [
  { value: 'REQUIRE_APPROVAL:BRANCH_MANAGER', label: 'Ask a branch manager to approve' },
  { value: 'REQUIRE_APPROVAL:ADMIN', label: 'Ask an admin to approve' },
  { value: 'CREATE_TASK:EXPIRY_ACTION', label: 'Create an expiry task' },
  { value: 'SEND_NOTIFICATION', label: 'Send a notification' },
  { value: 'BLOCK', label: 'Stop the action' },
];

const SUFFIXES = ['Gte', 'Lte', 'Gt', 'Lt'];

/** Server condition object -> list of { field, op, value } rows. */
export function conditionToRows(condition = {}) {
  return Object.entries(condition).map(([key, value]) => {
    const op = SUFFIXES.find((suffix) => key.endsWith(suffix) && key.length > suffix.length);
    return op ? { field: key.slice(0, -op.length), op, value: String(value) } : { field: key, op: 'eq', value: String(value) };
  });
}

/** Rows -> server condition object. Numbers compare numerically; "is" keeps a number when it looks like one. */
export function rowsToCondition(rows) {
  const condition = {};
  for (const row of rows) {
    if (!row.field) continue;
    const numeric = row.value !== '' && !Number.isNaN(Number(row.value));
    if (row.op === 'eq') condition[row.field] = numeric && fieldType(row.field) === 'number' ? Number(row.value) : row.value;
    else condition[`${row.field}${row.op}`] = Number(row.value);
  }
  return condition;
}

function fieldType(field) {
  return RULE_FIELDS.find((entry) => entry.value === field)?.type ?? 'text';
}

export function outcomeToAction(outcome = {}) {
  if (typeof outcome.action === 'string') return outcome.action;
  if (typeof outcome.requireApproval === 'string') return `REQUIRE_APPROVAL:${outcome.requireApproval}`;
  const [first] = Object.values(outcome);
  return String(first ?? '');
}

export function actionToOutcome(action) {
  if (action.startsWith('REQUIRE_APPROVAL:')) return { requireApproval: action.slice('REQUIRE_APPROVAL:'.length) };
  return { action };
}

/** One string from POST /rules/evaluate (an action, or a role for approval rules) in plain words. */
export function describeRuleResult(result) {
  if (RULE_ACTIONS.some((entry) => entry.value === result)) return labelOf(RULE_ACTIONS, result);
  if (ROLE_OPTIONS.some((role) => role.value === result)) return labelOf(RULE_ACTIONS, `REQUIRE_APPROVAL:${result}`) || `Ask a ${labelOf(ROLE_OPTIONS, result).toLowerCase()} to approve`;
  return result;
}

export function describeRule(rule) {
  const parts = conditionToRows(rule.condition).map((row) => `${labelOf(RULE_FIELDS, row.field)} ${labelOf(RULE_OPERATORS, row.op)} ${row.value}`);
  const then = labelOf(RULE_ACTIONS, outcomeToAction(rule.outcome));
  return `${parts.length ? `When ${parts.join(' and ')}` : 'Always'} → ${then || 'do nothing'}`;
}

// ---- reports ----------------------------------------------------------------

export const REPORT_DATASETS = [
  {
    value: 'inventory', label: 'Stock',
    columns: [
      { value: 'item_code', label: 'Item code & name' }, { value: 'category', label: 'Category' }, { value: 'company', label: 'Company' },
      { value: 'physical', label: 'Total physical' }, { value: 'book', label: 'Total book' }, { value: 'variance', label: 'Variance' },
      { value: 'reserved', label: 'Reserved' }, { value: 'quarantine', label: 'Quarantine' }, { value: 'available', label: 'Available' }, { value: 'value', label: 'Value' },
    ],
  },
  {
    value: 'transfers', label: 'Transfers',
    columns: [
      { value: 'transfer_no', label: 'Transfer no.' }, { value: 'from', label: 'From' }, { value: 'to', label: 'To' },
      { value: 'status', label: 'Status' }, { value: 'items', label: 'Items' }, { value: 'created_at', label: 'Created' },
    ],
  },
  {
    value: 'counts', label: 'Stock counts',
    columns: [
      { value: 'item_code', label: 'Item' }, { value: 'counted', label: 'Counted qty' }, { value: 'book', label: 'Book qty' },
      { value: 'variance', label: 'Difference' }, { value: 'counted_by', label: 'Counted by' }, { value: 'status', label: 'Status' },
    ],
  },
  {
    value: 'orders', label: 'Sales orders',
    columns: [
      { value: 'order_no', label: 'Order no.' }, { value: 'channel', label: 'Channel' }, { value: 'status', label: 'Status' },
      { value: 'lines', label: 'Lines' }, { value: 'created_at', label: 'Created' },
    ],
  },
  {
    value: 'purchase_orders', label: 'Purchase orders',
    columns: [
      { value: 'po_no', label: 'PO no.' }, { value: 'supplier', label: 'Supplier' }, { value: 'status', label: 'Status' },
      { value: 'expected_at', label: 'Expected' }, { value: 'value', label: 'Value' },
    ],
  },
];

export function datasetOf(entity) {
  return REPORT_DATASETS.find((dataset) => dataset.value === entity);
}

export function reportColumnLabel(entity, column) {
  return datasetOf(entity)?.columns.find((entry) => entry.value === column)?.label ?? column;
}

// ---- automations ------------------------------------------------------------

export const AUTOMATION_EVENTS = [
  { value: 'inventory.low_stock', label: 'Stock falls low' },
  { value: 'item.near_expiry', label: 'An item gets close to expiry' },
  { value: 'transfer.created', label: 'A transfer is created' },
  { value: 'count.submitted', label: 'A stock count is submitted' },
  { value: 'order.created', label: 'A sales order arrives' },
];

export const AUTOMATION_SCHEDULES = [
  { value: 'daily@09:00', label: 'Every day at 9 am' },
  { value: 'daily@18:00', label: 'Every day at 6 pm' },
  { value: 'weekly@mon', label: 'Every Monday' },
  { value: 'monthly@1', label: 'On the 1st of every month' },
];

export const AUTOMATION_ACTIONS = [
  { value: 'SEND_NOTIFICATION', label: 'Send a notification' },
  { value: 'SEND_EMAIL', label: 'Email the admins' },
  { value: 'CREATE_TASK', label: 'Create a task' },
  { value: 'SEND_WEBHOOK', label: 'Call our webhook' },
];

export function describeAutomation(automation) {
  const when = automation.trigger === 'schedule'
    ? labelOf(AUTOMATION_SCHEDULES, automation.expression)
    : `When ${labelOf(AUTOMATION_EVENTS, automation.expression).replace(/^./, (c) => c.toLowerCase())}`;
  return `${when} → ${labelOf(AUTOMATION_ACTIONS, automation.actionKey)}`;
}

// ---- mobile -----------------------------------------------------------------

export const MOBILE_SCREENS = [
  { value: 'dashboard', label: 'Home' },
  { value: 'stock', label: 'Stock' },
  { value: 'counts', label: 'Stock counts' },
  { value: 'picks', label: 'Picking' },
  { value: 'putaway', label: 'Put-away' },
  { value: 'transfers', label: 'Transfers' },
  { value: 'receiving', label: 'Receiving' },
];

export const OFFLINE_HOURS_OPTIONS = [4, 8, 12, 24, 48, 72];

// ---- approval workflows -----------------------------------------------------

export const WORKFLOW_TARGETS = [
  { value: 'transfer', label: 'Transfers' },
  { value: 'adjustment', label: 'Stock adjustments' },
  { value: 'count', label: 'Stock count results' },
  { value: 'purchase_order', label: 'Purchase orders' },
];

/** Server workflow (trigger -> condition -> auto action / approval) -> { key, name, target, threshold, approverRole }. */
export function workflowToModel(workflow) {
  const nodes = workflow.graph?.nodes ?? [];
  const event = String(nodes.find((node) => node.type === 'trigger')?.config?.event ?? '');
  const target = event.replace(/\.created$/, '') || workflow.key.split('.')[0];
  return {
    key: workflow.key,
    name: workflow.name,
    version: workflow.version ?? 1,
    target,
    threshold: String(nodes.find((node) => node.type === 'condition')?.config?.amount ?? ''),
    approverRole: String(nodes.find((node) => node.type === 'approval')?.config?.role ?? 'BRANCH_MANAGER'),
  };
}

export function modelToWorkflow(model) {
  return {
    key: model.key,
    name: model.name,
    version: Number(model.version) || 1,
    graph: {
      nodes: [
        { id: 'start', type: 'trigger', config: { event: `${model.target}.created` } },
        { id: 'check', type: 'condition', config: { field: 'value', op: 'lte', amount: Number(model.threshold) } },
        { id: 'auto', type: 'action', config: { action: 'AUTO_APPROVE' } },
        { id: 'manager', type: 'approval', config: { role: model.approverRole } },
      ],
    },
  };
}

export function describeWorkflow(model) {
  const amount = Number(model.threshold);
  const rupees = Number.isFinite(amount) ? `₹${amount.toLocaleString('en-IN')}` : '—';
  return `${labelOf(WORKFLOW_TARGETS, model.target)} up to ${rupees} are approved automatically; above that a ${labelOf(ROLE_OPTIONS, model.approverRole).toLowerCase()} must approve.`;
}

// ---- list editing -----------------------------------------------------------

/**
 * What to send to the server to turn `saved` into `edited`: entries to upsert
 * (new or changed) and ids to remove. `idOf` names an entry; it must not change
 * while editing (new entries get theirs when added).
 */
export function diffEntries(saved, edited, idOf) {
  const before = new Map(saved.map((entry) => [idOf(entry), JSON.stringify(entry)]));
  const after = new Set(edited.map(idOf));
  return {
    upserts: edited.filter((entry) => before.get(idOf(entry)) !== JSON.stringify(entry)),
    removals: [...before.keys()].filter((id) => !after.has(id)),
  };
}
