import { TransferRecord } from './repository.js';

export interface ThermalPDFOptions {
  transfer: TransferRecord;
  itemNames: Map<string, string>;
  locationNames: Map<string, string>;
  printedBy: string;
  printTime: string;
}

export function generateThermalTransferLabel(options: ThermalPDFOptions): string {
  const { transfer, itemNames, locationNames, printedBy, printTime } = options;

  const sourceLocation = locationNames.get(transfer.sourceLocationId) || transfer.sourceLocationId;
  const destLocation = locationNames.get(transfer.destinationLocationId) || transfer.destinationLocationId;

  const lines = transfer.lines
    .map((line) => {
      const itemName = itemNames.get(line.itemId) || line.itemId;
      return `${itemName} / LOT-${line.lotId} x${line.quantity}`;
    })
    .join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Transfer Label - ${transfer.id}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          width: 3in;
          height: 5in;
          padding: 0.2in;
          font-family: 'Courier New', monospace;
          font-size: 10pt;
          line-height: 1.2;
          background: white;
        }
        .label {
          display: flex;
          flex-direction: column;
          height: 100%;
          border: 2px solid #000;
          padding: 8px;
        }
        .header {
          text-align: center;
          font-weight: bold;
          font-size: 12pt;
          border-bottom: 1px solid #000;
          margin-bottom: 8px;
          padding-bottom: 4px;
        }
        .barcode-area {
          text-align: center;
          margin: 8px 0;
          font-family: 'Code128', 'Courier New';
          font-size: 24pt;
          letter-spacing: 2px;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          font-size: 9pt;
          margin: 2px 0;
        }
        .detail-label {
          font-weight: bold;
          min-width: 40%;
        }
        .detail-value {
          flex: 1;
          text-align: right;
        }
        .from-to {
          border: 1px solid #000;
          padding: 4px;
          margin: 4px 0;
          font-size: 9pt;
          font-weight: bold;
        }
        .items-section {
          flex: 1;
          border: 1px solid #000;
          padding: 4px;
          margin: 4px 0;
          overflow: hidden;
          font-size: 8pt;
        }
        .items-section pre {
          font-family: 'Courier New', monospace;
          white-space: pre-wrap;
          word-wrap: break-word;
          margin: 0;
        }
        .footer {
          font-size: 8pt;
          border-top: 1px solid #000;
          padding-top: 4px;
          text-align: center;
        }
        .info-small {
          font-size: 7pt;
          line-height: 1;
        }
        @media print {
          body {
            width: 3in;
            height: 5in;
            margin: 0;
            padding: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="label">
        <div class="header">
          TRANSFER LABEL
        </div>

        <div class="barcode-area">
          ***${transfer.id.slice(-8)}***
        </div>

        <div class="from-to">
          FROM: ${sourceLocation}<br>
          TO: ${destLocation}
        </div>

        <div class="detail-row">
          <span class="detail-label">CARTONS:</span>
          <span class="detail-value">${transfer.cartonCount || '-'}</span>
        </div>

        <div class="items-section">
          <strong>ITEMS:</strong><br>
          <pre>${lines}</pre>
        </div>

        <div class="footer">
          <div class="info-small">
            <strong>ID:</strong> ${transfer.id}<br>
            <strong>PRINTED:</strong> ${printTime}<br>
            <strong>BY:</strong> ${printedBy}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return html;
}

export interface ReportEntry {
  printTime: string;
  transferId: string;
  printedBy: string;
  printCount: number;
  notes?: string;
}

export const reprintAuditLog: ReportEntry[] = [];

export function recordReprint(entry: Omit<ReportEntry, 'printCount'>): void {
  const existing = reprintAuditLog.find((e) => e.transferId === entry.transferId);
  if (existing) {
    existing.printCount += 1;
  } else {
    reprintAuditLog.push({ ...entry, printCount: 1 });
  }
}

export function getReprintAudit(transferId?: string): ReportEntry[] {
  if (transferId) {
    return reprintAuditLog.filter((e) => e.transferId === transferId);
  }
  return [...reprintAuditLog];
}
