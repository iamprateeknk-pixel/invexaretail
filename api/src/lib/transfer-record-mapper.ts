// One place that turns Transfer / TransferCarton rows into the records the API serves. Used by snapshot
// hydration (lib/persistence.ts), the delta refresh and the database-first transfer repository
// (lib/repositories/transfer-repository.ts), so the three cannot drift apart — the same pattern
// lib/count-record-mapper.ts and lib/item-record-mapper.ts already established.
//
// Known parity-preserving limitation: the historical hydration mapping drops TransferLine.excessQty
// (the snapshot record never carried it), so the database-first read does not either. Surfacing
// excessQty to clients is a deliberate product change, not something to smuggle into this migration.
import type { TransferRecord } from './repository.js';
import type { TransferCartonRecord } from './transfer-packing.js';

// Packing/dispatch details live in one JSON column; JSON null means "not set yet".
export function logisticsOf(transfer: unknown): Pick<TransferRecord, 'packing' | 'dispatch'> {
  const raw = (transfer as { logistics?: { packing?: TransferRecord['packing'] | null; dispatch?: TransferRecord['dispatch'] | null } | null }).logistics;
  return { ...(raw?.packing ? { packing: raw.packing } : {}), ...(raw?.dispatch ? { dispatch: raw.dispatch } : {}) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transferRowToRecord(transfer: any): TransferRecord {
  return {
    id: transfer.id,
    sourceLocationId: transfer.sourceLocationId,
    destinationLocationId: transfer.destinationLocationId,
    requestedBy: transfer.requestedById,
    role: 'ADMIN' as const,
    status: transfer.status,
    cartonCount: transfer.cartonCount ?? undefined,
    notes: transfer.notes ?? undefined,
    lines: (transfer.lines ?? []).map((line: any) => ({ itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty), receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty), shortageQty: Number(line.shortageQty ?? 0) })),
    ...logisticsOf(transfer),
    ...(transfer.assignedPickerId ? { assignedPickerId: transfer.assignedPickerId } : {}),
    createdAt: transfer.createdAt.toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transferCartonRowToRecord(row: any): TransferCartonRecord {
  const contents = (row.contents ?? {}) as { lines?: Array<{ itemId: string; lotId: string; quantity: number }>; packedById?: string; sealedAt?: string; requestId?: string };
  return {
    id: row.id,
    transferId: row.transferId,
    cartonNumber: row.cartonNumber,
    packageId: row.qrCode ?? row.cartonNumber,
    lines: contents.lines ?? [],
    quantity: Number(row.quantity),
    weightKg: row.weight ?? undefined,
    status: (row.status === 'VOID' ? 'VOID' : 'SEALED') as 'SEALED' | 'VOID',
    packedById: contents.packedById ?? '',
    sealedAt: contents.sealedAt ?? row.createdAt.toISOString(),
    requestId: contents.requestId,
  };
}
