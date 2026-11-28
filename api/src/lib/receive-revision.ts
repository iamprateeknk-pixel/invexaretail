import { createHash } from 'node:crypto';
import { DomainError } from './errors.js';

type ReceiveLine = {
  id: string; itemId: string; lotId: string;
  requestedQty: unknown; receivedQty: unknown; damagedQty: unknown; shortageQty: unknown; excessQty: unknown;
};

export function receiveRevision(transfer: { id: string; destinationLocationId: string; status: string }, lines: readonly ReceiveLine[]): string {
  const quantities = lines.map((line) => JSON.stringify([
    line.id, line.itemId, line.lotId,
    ...[line.requestedQty, line.receivedQty, line.damagedQty, line.shortageQty, line.excessQty].map((qty) => Number(qty ?? 0)),
  ])).sort();
  return createHash('sha256').update(JSON.stringify([transfer.id, transfer.destinationLocationId, transfer.status, quantities])).digest('hex');
}

export function transferReceiveChanged(): DomainError {
  return new DomainError('TRANSFER_RECEIVE_CHANGED', 'This transfer changed. Refresh it and check the remaining quantities before receiving again.');
}
