export function buildSalesCsv(rowCount: number, options?: {
  branchName?: string;
  itemCode?: string;
  itemName?: string;
  quantity?: number;
  includeLineNo?: boolean;
  rowSource?: string;
}): string {
  const branchName = options?.branchName ?? 'Main Store';
  const itemCode = options?.itemCode ?? 'SKU-1001';
  const itemName = options?.itemName ?? 'Rice 5kg';
  const quantity = options?.quantity ?? 0.01;
  const includeLineNo = options?.includeLineNo ?? true;
  const rowSource = options?.rowSource ?? 'ERP';
  const headers = includeLineNo
    ? ['S_No.', 'BRANCH NAME', 'BILL DATE', 'BILL TIME', 'BILL NO.', 'ITEM CODE', 'ITEM NAME', 'LOT NO.', 'UNIT', 'TOTAL QTY', 'ROW SOURCE']
    : ['BRANCH NAME', 'BILL DATE', 'BILL TIME', 'BILL NO.', 'ITEM CODE', 'ITEM NAME', 'LOT NO.', 'UNIT', 'TOTAL QTY', 'ROW SOURCE'];
  const lines = [headers.join(',')];
  for (let index = 1; index <= rowCount; index += 1) {
    const cells = [
      includeLineNo ? String(index) : undefined,
      branchName,
      '11/09/2026',
      '10:18 AM',
      `DGR-${index}`,
      itemCode,
      itemName,
      'LOT-01',
      'KG',
      String(quantity),
      rowSource,
    ].filter((cell): cell is string => cell !== undefined);
    lines.push(cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','));
  }
  return lines.join('\n');
}

export function salesCsvBuffer(rowCount: number, options?: Parameters<typeof buildSalesCsv>[1]): Buffer {
  return Buffer.from(buildSalesCsv(rowCount, options));
}
