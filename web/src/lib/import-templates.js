export const SALES_IMPORT_TEMPLATE = [
  'S_No.,Branch Name,Bill Date,Bill Time,Bill No.,Item Code,Item Name,Lot No.,Unit,Total Qty,Row Source',
  '1,Main Store,11/09/2026,10:18 AM,DGR-1,SKU-1001,Rice 5kg,LOT-01,KG,1,ERP',
].join('\n');

export const PURCHASE_IMPORT_TEMPLATE = [
  'SNO.,Bill Date,Bill No.,Item Code,Item Name,Pack/Grade,Lot No.,Total Qty,Row Source',
  '1,11/09/2026,HOST-1,SKU-1001,Rice 5kg,KG,LOT-01,10,ERP',
].join('\n');

export const OPENING_STOCK_TEMPLATE = [
  'COMPANY NAME,BRANCH NAME,CATEGORY,SUB CATEGORY,ITEM CODE,ITEM NAME,PACK/SIZE,BATCH,LOT CODE,EXPIRY DATE,CLOSING STOCK',
  'Invexa,Main Store,Staples,Grains,SKU-1001,Rice 5kg,KG,B1,LOT-01,31/12/2027,25',
].join('\n');

export function downloadCsvTemplate(filename, csv) {
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
