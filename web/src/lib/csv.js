// CSV export for the shared table toolbar. Exports exactly what the person is looking at (the filtered
// rows and the visible columns). Cells that a spreadsheet could execute as a formula (= + - @ and
// tab/CR leads) are prefixed with an apostrophe so an exported inventory file cannot run code when opened.

const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // A plain negative number is data, not a formula.
  if (FORMULA_LEAD.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** columns: [{ label, value: (row) => cell }] ; rows: any array. Returns CSV text with CRLF line ends. */
export function toCsv(columns, rows) {
  const header = columns.map((column) => csvCell(column.label)).join(',');
  const lines = (rows ?? []).map((row) => columns.map((column) => csvCell(column.value(row))).join(','));
  return [header, ...lines].join('\r\n');
}

/** Triggers a browser download of `text` as `filename` (UTF-8 with BOM so Excel reads non-ASCII names). */
export function downloadCsv(filename, text) {
  const blob = new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
