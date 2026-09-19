// Blueprint "Returns/RMA: a formal customer-return/RMA/inspection flow" -
// deterministic quantity validation and status state machine. Never
// touches the ledger itself; the route decides what to do with a
// RESTOCK-disposition line once a return reaches RECEIVED.

export type ReturnLineInput = {
  orderLineId: string;
  quantity: number;
  fulfilledQty: number;
  alreadyReturnedQty: number;
};

export type ReturnLineValidation = {
  ok: boolean;
  errors: string[];
};

export function validateReturnLines(lines: ReturnLineInput[]): ReturnLineValidation {
  const errors: string[] = [];
  if (!lines.length) errors.push('At least one return line is required.');
  for (const line of lines) {
    if (!(line.quantity > 0)) {
      errors.push(`Line ${line.orderLineId}: return quantity must be positive.`);
      continue;
    }
    const remaining = line.fulfilledQty - line.alreadyReturnedQty;
    if (line.quantity > remaining) {
      errors.push(`Line ${line.orderLineId}: cannot return ${line.quantity}, only ${remaining} of the fulfilled quantity remains eligible.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'CLOSED';
export type ReturnAction = 'APPROVE' | 'REJECT' | 'RECEIVE' | 'CLOSE';

const TRANSITIONS: Record<ReturnStatus, Partial<Record<ReturnAction, ReturnStatus>>> = {
  REQUESTED: { APPROVE: 'APPROVED', REJECT: 'REJECTED' },
  APPROVED: { RECEIVE: 'RECEIVED' },
  REJECTED: {},
  RECEIVED: { CLOSE: 'CLOSED' },
  CLOSED: {},
};

// Returns the next status, or null when that action is not legal from the
// current status - the caller turns null into a 409, it never silently
// no-ops a status change.
export function nextReturnStatus(current: ReturnStatus, action: ReturnAction): ReturnStatus | null {
  return TRANSITIONS[current][action] ?? null;
}

export type ReturnLineDisposition = 'RESTOCK' | 'SCRAP' | 'RETURN_TO_VENDOR';

export function isRestockDisposition(disposition: string): disposition is 'RESTOCK' {
  return disposition === 'RESTOCK';
}

// ---------------------------------------------------------------------------
// Blueprint v4 §24: "Returned stock must not automatically become sellable
// before QC/disposition when policy requires inspection." A received return
// is held in quarantine until a disposition is decided; RESTOCK is only
// allowed once QC passed wherever a QC template applies to the item.
// ---------------------------------------------------------------------------

export const PENDING_INSPECTION = 'PENDING_INSPECTION';
export const QC_FAILED = 'QC_FAILED';

export type ReturnLinePlan =
  | { ok: true; action: 'RESTOCK' | 'HOLD' | 'SCRAP' | 'VENDOR'; disposition: string; note?: string }
  | { ok: false; message: string };

/** What to do with one returned line. `requested` empty means "decide later" - the goods are held, never restocked by default. */
export function planReturnLine(input: { requested?: string | null; qcRequired: boolean; verdict: 'PASS' | 'FAIL' | null }): ReturnLinePlan {
  const requested = (input.requested ?? '').trim().toUpperCase();
  if (!requested || requested === PENDING_INSPECTION) {
    return { ok: true, action: 'HOLD', disposition: PENDING_INSPECTION, note: 'Held in quarantine until inspected.' };
  }
  if (requested === 'SCRAP') return { ok: true, action: 'SCRAP', disposition: 'SCRAP' };
  if (requested === 'RETURN_TO_VENDOR') return { ok: true, action: 'VENDOR', disposition: 'RETURN_TO_VENDOR' };
  if (requested !== 'RESTOCK') return { ok: false, message: `Unknown disposition "${requested}". Use RESTOCK, SCRAP or RETURN_TO_VENDOR.` };
  if (!input.qcRequired) return { ok: true, action: 'RESTOCK', disposition: 'RESTOCK' };
  if (input.verdict === 'PASS') return { ok: true, action: 'RESTOCK', disposition: 'RESTOCK' };
  if (input.verdict === 'FAIL') return { ok: true, action: 'HOLD', disposition: QC_FAILED, note: 'QC failed: held in quarantine. Scrap it or return it to the vendor.' };
  return { ok: false, message: 'A QC inspection is required before this return can be restocked. Record the inspection, or hold it in quarantine.' };
}

export function isPendingDisposition(disposition: string | null | undefined): boolean {
  return !disposition || disposition === PENDING_INSPECTION || disposition === QC_FAILED;
}

/** A return can only be closed once nothing is still waiting for a disposition. */
export function canCloseReturn(lines: Array<{ disposition?: string | null }>): { ok: true } | { ok: false; message: string } {
  const waiting = lines.filter((line) => isPendingDisposition(line.disposition)).length;
  return waiting ? { ok: false, message: `${waiting} returned line(s) are still in quarantine awaiting a disposition.` } : { ok: true };
}

export type RefundStatus = 'PENDING' | 'REFUNDED' | 'DENIED';

export function parseRefundDecision(value: unknown): 'REFUNDED' | 'DENIED' | null {
  return value === 'REFUNDED' || value === 'DENIED' ? value : null;
}
