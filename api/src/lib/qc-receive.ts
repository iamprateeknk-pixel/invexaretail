import { findTemplateForCategory, type QcTemplateLike } from './qc-inspection.js';

// Blueprint §8.2: receiving is not complete until a matching QC checklist
// has been recorded for every good-stock line. Templates stay optional
// until an admin publishes one; once a template matches the item category
// (or a global default exists), the receive API refuses to post stock.

export type ReceiptQcLine = {
  lineId?: string;
  itemId: string;
  itemCategory?: string | null;
  receivedQty: number;
  hasInspection: boolean;
};

export function receiptLineRequiresQc(
  line: ReceiptQcLine,
  templates: QcTemplateLike[],
): boolean {
  if (!(line.receivedQty > 0)) return false;
  return findTemplateForCategory(templates, line.itemCategory ?? null) !== null;
}

export function assertReceiptQcComplete(
  lines: ReceiptQcLine[],
  templates: QcTemplateLike[],
): { ok: true } | { ok: false; message: string; lineId?: string; itemId: string } {
  for (const line of lines) {
    if (!receiptLineRequiresQc(line, templates)) continue;
    if (!line.hasInspection) {
      return {
        ok: false,
        itemId: line.itemId,
        lineId: line.lineId,
        message: `QC checklist is required before receiving ${line.itemId}. Record an inspection, then post the receipt.`,
      };
    }
  }
  return { ok: true };
}
