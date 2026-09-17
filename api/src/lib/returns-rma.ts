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
