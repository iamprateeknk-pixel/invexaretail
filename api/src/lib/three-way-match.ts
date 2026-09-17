// Blueprint P7 "3-way match: PO vs GRN vs supplier invoice; tolerance and
// exception workflow." Deterministic comparison, no ML - a mismatch always
// names exactly which of the three documents disagreed and by how much, so
// an AP clerk can resolve it without re-deriving the numbers themselves.

export type ThreeWayMatchPoLine = {
  itemId: string;
  orderedQty: number;
  receivedQty: number;
  unitCost: number;
};

export type ThreeWayMatchInvoiceLine = {
  itemId: string;
  invoicedQty: number;
  unitCost: number;
};

export type ThreeWayMatchException =
  | 'UNKNOWN_ITEM'
  | 'OVER_INVOICED_QTY'
  | 'PRICE_VARIANCE';

export type ThreeWayMatchLineResult = {
  itemId: string;
  orderedQty: number;
  receivedQty: number;
  invoicedQty: number;
  poUnitCost: number;
  invoicedUnitCost: number | null;
  exceptions: ThreeWayMatchException[];
};

export type ThreeWayMatchResult = {
  lines: ThreeWayMatchLineResult[];
  matched: boolean;
};

const DEFAULT_PRICE_TOLERANCE_PERCENT = 2;

export function matchThreeWay(
  poLines: ThreeWayMatchPoLine[],
  invoiceLines: ThreeWayMatchInvoiceLine[],
  tolerancePercent: number = DEFAULT_PRICE_TOLERANCE_PERCENT,
): ThreeWayMatchResult {
  const poByItem = new Map(poLines.map((line) => [line.itemId, line]));
  const invoiceByItem = new Map(invoiceLines.map((line) => [line.itemId, line]));
  const allItemIds = new Set([...poByItem.keys(), ...invoiceByItem.keys()]);

  const lines: ThreeWayMatchLineResult[] = [];
  for (const itemId of allItemIds) {
    const po = poByItem.get(itemId);
    const invoice = invoiceByItem.get(itemId);
    const exceptions: ThreeWayMatchException[] = [];

    if (!po) {
      exceptions.push('UNKNOWN_ITEM');
      lines.push({
        itemId, orderedQty: 0, receivedQty: 0, invoicedQty: invoice?.invoicedQty ?? 0,
        poUnitCost: 0, invoicedUnitCost: invoice?.unitCost ?? null, exceptions,
      });
      continue;
    }

    const invoicedQty = invoice?.invoicedQty ?? 0;
    if (invoicedQty > po.receivedQty) exceptions.push('OVER_INVOICED_QTY');

    if (invoice && po.unitCost > 0) {
      const variancePercent = Math.abs((invoice.unitCost - po.unitCost) / po.unitCost) * 100;
      if (variancePercent > tolerancePercent) exceptions.push('PRICE_VARIANCE');
    }

    lines.push({
      itemId,
      orderedQty: po.orderedQty,
      receivedQty: po.receivedQty,
      invoicedQty,
      poUnitCost: po.unitCost,
      invoicedUnitCost: invoice?.unitCost ?? null,
      exceptions,
    });
  }

  return { lines, matched: lines.every((line) => line.exceptions.length === 0) };
}
