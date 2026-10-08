import { databaseEnabled } from './persistence.js';
import { loadTransferPickSlips } from './persistence.js';
import { listAuditEvents } from './audit.js';

// The pick slips saved against a transfer: from the audit journal in memory mode, from the database otherwise.
export async function savedPickSlips(transferId: string) {
  if (databaseEnabled) return loadTransferPickSlips(transferId);
  return listAuditEvents().filter((event) => event.entityType === 'Transfer' && event.entityId === transferId && event.action === 'PICK_SLIP_SAVED');
}
