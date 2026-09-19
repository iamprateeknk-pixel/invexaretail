// Blueprint v4 §22 on the web: the purchase-order stage buttons and the receipt request.

const ADMIN_ROLES = ['ADMIN', 'ADMIN_USER'];

/** The next status moves an admin can make from here (mirrors api/src/lib/po-lifecycle.ts). */
export function poActions(role, status) {
  if (!ADMIN_ROLES.includes(role)) return { moves: [], receive: false };
  const moves = {
    DRAFT: [{ to: 'SUBMITTED', label: 'Submit for approval' }, { to: 'CANCELLED', label: 'Cancel', tone: 'destructive' }],
    SUBMITTED: [{ to: 'APPROVED', label: 'Approve' }, { to: 'DRAFT', label: 'Send back' }, { to: 'CANCELLED', label: 'Cancel', tone: 'destructive' }],
    APPROVED: [{ to: 'SENT', label: 'Mark sent' }, { to: 'CANCELLED', label: 'Cancel', tone: 'destructive' }],
    SENT: [{ to: 'CANCELLED', label: 'Cancel', tone: 'destructive' }],
    PARTIALLY_RECEIVED: [{ to: 'CLOSED', label: 'Short close', needsNote: true }],
    RECEIVED: [{ to: 'CLOSED', label: 'Close' }],
  }[status] ?? [];
  return { moves, receive: ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(status) };
}

export function emptyReceiptLine() {
  return { received: '', damaged: '', excess: '', lotNo: '', expiryDate: '' };
}

const number = (value) => (value === '' || value === undefined || value === null ? 0 : Number(value));

/**
 * The receive request body. `requestId` is created when the dialog opens and
 * kept for every retry, so a double click or a timeout can never post twice.
 */
export function receiptBody(order, form, requestId) {
  const lines = [];
  for (const line of order.lines ?? []) {
    const entry = form[line.id] ?? emptyReceiptLine();
    const [received, damaged, excess] = [number(entry.received), number(entry.damaged), number(entry.excess)];
    if ([received, damaged, excess].some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Enter valid quantities.');
    if (received + damaged + excess <= 0) continue;
    const remaining = Math.max(0, Number(line.quantity) - Number(line.receivedQty ?? 0));
    if (received + damaged > remaining + 1e-8) throw new Error(`${line.item?.name ?? line.itemId}: only ${remaining} is still open. Enter anything more as excess.`);
    lines.push({
      lineId: line.id, receivedQty: received, damagedQty: damaged, excessQty: excess,
      ...(entry.lotNo.trim() ? { lotNo: entry.lotNo.trim() } : {}), ...(entry.expiryDate ? { expiryDate: entry.expiryDate } : {}),
    });
  }
  if (!lines.length) throw new Error('Enter what arrived on at least one line.');
  return { requestId, lines };
}

/** One line for the register: how much of the order has arrived. */
export function receiptProgress(order) {
  const ordered = (order.lines ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
  const received = (order.lines ?? []).reduce((sum, line) => sum + Number(line.receivedQty ?? 0), 0);
  return { ordered, received, percent: ordered ? Math.min(100, Math.round((received / ordered) * 100)) : 0 };
}

export const urgencyVariant = (urgency) => (urgency === 'CRITICAL' ? 'destructive' : urgency === 'HIGH' ? 'warning' : 'outline');
