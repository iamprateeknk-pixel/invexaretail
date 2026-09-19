// Blueprint v4 §22 Purchase orders:
//   Reorder signal -> Draft PO -> Supplier selection -> Approval -> Send ->
//   Expected receipt -> Partial/full receive -> Invoice match -> Close
// PATCH /purchase-orders/:id/status used to accept any status from any status.
// This is the one place that says which moves are legal.

export type PoStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';

export const PO_STATUSES: readonly PoStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'];

const MOVES: Record<PoStatus, PoStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SENT', 'CANCELLED'],
  SENT: ['CANCELLED'],
  // Receiving moves these; the status route only offers the closing moves.
  PARTIALLY_RECEIVED: ['CLOSED'],
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function isPoStatus(value: unknown): value is PoStatus {
  return typeof value === 'string' && (PO_STATUSES as readonly string[]).includes(value);
}

export function allowedPoMoves(from: PoStatus): PoStatus[] {
  return MOVES[from] ?? [];
}

/** Goods can arrive once the order is approved - and only until it is closed or cancelled. */
export function isReceivablePo(status: string): boolean {
  return ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(status);
}

export type PoMoveCheck = { ok: true } | { ok: false; message: string };

export function checkPoMove(input: {
  from: PoStatus;
  to: PoStatus;
  anyReceived: boolean;
  invoiceStatuses: string[];
  note?: string | null;
}): PoMoveCheck {
  if (!allowedPoMoves(input.from).includes(input.to)) {
    return { ok: false, message: `A purchase order cannot move from ${input.from} to ${input.to}.` };
  }
  if (input.to === 'CANCELLED' && input.anyReceived) {
    return { ok: false, message: 'Goods were already received against this order, so it cannot be cancelled. Close it instead.' };
  }
  const note = (input.note ?? '').trim();
  if (input.to === 'CLOSED') {
    if (input.from === 'PARTIALLY_RECEIVED' && note.length < 5) {
      return { ok: false, message: 'Closing an order that is only partly received (short close) needs a reason of at least 5 characters.' };
    }
    // Blueprint: close follows the invoice match. Without a matched invoice the
    // finance team must say why it is closing anyway.
    if (!input.invoiceStatuses.includes('MATCHED') && note.length < 5) {
      return { ok: false, message: 'No supplier invoice has been matched to this order. Match one, or give a reason of at least 5 characters to close without it.' };
    }
  }
  return { ok: true };
}
