import { code39Svg, escapeHtml } from './barcode.js';

export function buildItemLabelDocument({ source, item, lot, locationName }) {
  const code = lot?.lotNo ?? source.code ?? source.id ?? item.itemId;
  const html = `<!doctype html><html><head><title>${escapeHtml(code)}</title><style>@page{size:60mm 35mm;margin:2mm}body{font-family:Arial,sans-serif;margin:0;color:#020617}.label{width:56mm;height:31mm;display:flex;flex-direction:column;justify-content:center}.name{font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{display:flex;justify-content:space-between;font-size:8px;color:#475569;margin-top:2px}.barcode{height:15mm;margin-top:2px}.code{text-align:center;font:700 9px monospace;letter-spacing:1px}@media print{button{display:none}}</style></head><body><div class="label"><div class="name">${escapeHtml(source.name ?? item.itemName)}</div><div class="meta"><span>${escapeHtml(source.code ?? source.id)}</span><span>${escapeHtml(lot ? `LOT ${lot.lotNo}` : locationName)}</span></div><div class="barcode">${code39Svg(code)}</div><div class="code">${escapeHtml(code)}</div></div><script>window.onload=()=>window.print()</script></body></html>`;
  return { title: String(code ?? ''), html };
}

export function buildTransferSlipDocument(transfer, printedAt) {
  const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Transfer ${escapeHtml(transfer.id)}</title>
        <style>
          body { font-family: monospace; margin: 0; padding: 10px; width: 80mm; }
          .header { text-align: center; font-weight: bold; margin-bottom: 10px; }
          .section { margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
          .row { display: flex; justify-content: space-between; font-size: 11px; }
          .label { font-weight: bold; width: 40%; }
          .value { text-align: right; width: 60%; }
          .footer { text-align: center; font-size: 10px; margin-top: 10px; }
          @media print { body { margin: 0; padding: 5px; } }
        </style>
      </head>
      <body>
        <div class="header">STOCK TRANSFER</div>
        <div class="section">
          <div class="row">
            <div class="label">ID:</div>
            <div class="value">${escapeHtml(transfer.id)}</div>
          </div>
          <div class="row">
            <div class="label">Date:</div>
            <div class="value">${escapeHtml(printedAt)}</div>
          </div>
          <div class="row">
            <div class="label">Status:</div>
            <div class="value">${escapeHtml(transfer.status)}</div>
          </div>
        </div>

        <div class="section">
          <div class="row">
            <div class="label">From:</div>
            <div class="value">${escapeHtml(transfer.fromName)}</div>
          </div>
          <div class="row">
            <div class="label">To:</div>
            <div class="value">${escapeHtml(transfer.toName)}</div>
          </div>
          <div class="row">
            <div class="label">Cartons:</div>
            <div class="value">${escapeHtml(transfer.cartonCount || '-')}</div>
          </div>
        </div>

        <div class="section">
          <div class="row">
            <div class="label">Item:</div>
            <div class="value">${escapeHtml(transfer.item)}</div>
          </div>
          <div class="row">
            <div class="label">Qty:</div>
            <div class="value">${escapeHtml(transfer.qty)} units</div>
          </div>
        </div>

        <div class="footer">
          PRINT DATE: ${escapeHtml(printedAt)}<br>
          AUTHORIZED FOR TRANSFER
        </div>
      </body>
      </html>
    `;
  return { title: `Transfer ${transfer.id}`, html };
}
