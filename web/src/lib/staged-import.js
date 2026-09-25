// Guide Week 11: pure helpers for the import wizard (preview -> validate ->
// stage -> commit -> reconcile -> reverse). No network, no React - the hook and
// page are thin shells over these so the parsing and state rules are testable.

export const IMPORT_TYPES = [
  { value: 'PURCHASE', label: 'Purchase (enters at HO Basni)', policy: 'Partial success: valid rows post, invalid rows are exported for repair.' },
  { value: 'SALES', label: 'Sales (routed by branch name and bill time)', policy: 'Partial success: valid rows post, invalid rows are exported for repair.' },
  { value: 'SALES_RETURN', label: 'Sales return (adds stock to the correct branch)', policy: 'Partial success: valid rows post, invalid rows are exported for repair.' },
  { value: 'OPENING_STOCK', label: 'Opening stock', policy: 'All or nothing: one invalid row blocks the whole file.' },
];

export const MAX_PREVIEW_ROWS = 50_000;

const HEADER_ALIASES = {
  itemcode: 'itemCode', item_code: 'itemCode', sku: 'itemCode', code: 'itemCode', 'item code': 'itemCode',
  lotno: 'lotNo', lot_no: 'lotNo', lot: 'lotNo', batch: 'lotNo', 'lot no': 'lotNo', 'lot number': 'lotNo',
  quantity: 'quantity', qty: 'quantity',
  branchname: 'branchName', branch_name: 'branchName', branch: 'branchName', 'branch name': 'branchName',
  transactionat: 'transactionAt', transaction_at: 'transactionAt', date: 'transactionAt', 'bill time': 'transactionAt', 'bill date': 'transactionAt',
};

/** Splits one CSV record, honouring double-quoted fields and "" escapes. */
function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/**
 * Parses pasted/uploaded CSV text into the API's raw row shape. Quantities and
 * dates are passed through as text - the *server* owns Decimal parsing and row
 * validation, so the preview never disagrees with what commit will do.
 */
export function parseImportCsv(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return { rows: [], problems: ['The file is empty.'] };
  const header = splitCsvLine(lines[0]).map((name) => HEADER_ALIASES[name.toLowerCase()] ?? null);
  const problems = [];
  if (!header.includes('itemCode')) problems.push('A column for the item code (itemCode / SKU) is required.');
  if (!header.includes('quantity')) problems.push('A quantity column is required.');
  if (problems.length) return { rows: [], problems };
  if (lines.length - 1 > MAX_PREVIEW_ROWS) return { rows: [], problems: [`Files are limited to ${MAX_PREVIEW_ROWS.toLocaleString()} rows; split this one.`] };

  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((field, index) => { if (field && cells[index] !== undefined && cells[index] !== '') row[field] = cells[index]; });
    return row;
  });
  return { rows, problems: [] };
}

/** Turns the failure export into CSV a user can fix and re-upload. */
export function failuresToCsv(failures) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return ['row,field,code,message', ...failures.map((f) => [f.rowNumber, f.field, f.code, f.message].map(escape).join(','))].join('\r\n');
}

export const TERMINAL_STATUSES = ['COMMITTED', 'PARTIALLY_COMMITTED', 'FAILED', 'REVERSED'];

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/** Which wizard step a batch status belongs to. */
export function stepForStatus(status) {
  switch (status) {
    case 'DRAFT': return 'validate';
    case 'VALIDATED': return 'confirm';
    case 'QUEUED_FOR_COMMIT':
    case 'COMMITTING':
    case 'REVERSING': return 'progress';
    default: return 'result';
  }
}

export function commitProgress(batch) {
  const total = Number(batch?.totalRows ?? 0);
  const done = Math.min(total, Number(batch?.checkpointRowNumber ?? 0));
  return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

export function canCommit(batch, policyType) {
  if (!batch || batch.status !== 'VALIDATED') return { ok: false, reason: 'Validate the file first.' };
  if (Number(batch.validRows ?? 0) === 0) return { ok: false, reason: 'No valid rows to post.' };
  if (policyType === 'OPENING_STOCK' && Number(batch.invalidRows ?? 0) > 0) {
    return { ok: false, reason: 'Opening stock is all-or-nothing: fix every invalid row first.' };
  }
  return { ok: true };
}

export function canReverse(batch) {
  return Boolean(batch) && ['COMMITTED', 'PARTIALLY_COMMITTED'].includes(batch.status);
}
