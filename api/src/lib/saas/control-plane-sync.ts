import { randomBytes } from 'node:crypto';
import { ControlPlaneError, nowIso } from './control-plane.js';
import type { MutationStatus, SyncMutation } from './control-plane.js';
import type { ControlPlaneStore } from './control-plane-store.js';

/** Cross-calls the sync area needs from the facade (they stay on ControlPlane). */
export interface ControlPlaneSyncHost {
  assertFeature(companyId: string, featureKey: string): void;
  assertBillingWritable(companyId: string): void;
}

/** Offline sync mutations, stock ledger and devices (area S6 of the ControlPlane facade). */
export class ControlPlaneSync {
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly host: ControlPlaneSyncHost,
  ) {}

  enqueueMutation(input: Omit<SyncMutation, 'status' | 'retryCount' | 'lastError' | 'result' | 'serverAckAt' | 'createdAt'> & { status?: MutationStatus }): SyncMutation {
    this.host.assertBillingWritable(input.companyId);
    if (input.entityType === 'inventory' || input.actionType === 'STOCK_ADJUST' || input.actionType === 'POST_STOCK_ADJUSTMENT') {
      this.host.assertFeature(input.companyId, 'INVENTORY');
    }
    const existing = this.store.mutations.get(input.mutationId);
    if (existing) return existing;
    const mutation: SyncMutation = {
      ...input,
      status: input.status ?? 'pending_sync',
      retryCount: 0,
      lastError: null,
      result: null,
      createdAt: nowIso(),
      serverAckAt: null,
    };
    this.store.mutations.set(mutation.mutationId, mutation);
    return this.processMutation(mutation.mutationId);
  }

  processMutation(mutationId: string): SyncMutation {
    const mutation = this.store.mutations.get(mutationId);
    if (!mutation) throw new ControlPlaneError('Mutation not found', 'MUTATION_NOT_FOUND', 404);
    if (mutation.status === 'synced') return mutation;
    mutation.status = 'syncing';
    if (mutation.actionType === 'STOCK_ADJUST' || mutation.actionType === 'POST_STOCK_ADJUSTMENT') {
      const itemId = String(mutation.payload.itemId ?? 'item-1');
      const delta = Number(mutation.payload.delta);
      if (!Number.isFinite(delta)) {
        mutation.status = 'rejected';
        mutation.lastError = 'Stock mutations must submit a movement delta, not a final quantity.';
        return mutation;
      }
      if (mutation.payload.quantity !== undefined && mutation.payload.delta === undefined) {
        mutation.status = 'rejected';
        mutation.lastError = 'NEVER_LAST_WRITE_WINS_STOCK';
        return mutation;
      }
      const key = this.ledgerKey(mutation.companyId, itemId);
      this.store.ledger.set(key, (this.store.ledger.get(key) ?? 0) + delta);
      mutation.result = { itemId, onHand: this.store.ledger.get(key) };
      mutation.status = 'synced';
      mutation.serverAckAt = nowIso();
      return mutation;
    }
    if (mutation.actionType === 'TASK_COMPLETE' && mutation.payload.alreadyCompleted) {
      mutation.status = 'conflict';
      mutation.lastError = 'Task already completed elsewhere';
      return mutation;
    }
    if (mutation.payload.permissionRevoked) {
      mutation.status = 'rejected';
      mutation.lastError = 'Permission revoked while offline';
      return mutation;
    }
    mutation.status = 'synced';
    mutation.serverAckAt = nowIso();
    mutation.result = { ok: true };
    return mutation;
  }

  stockOnHand(companyId: string, itemId: string): number {
    return this.store.ledger.get(this.ledgerKey(companyId, itemId)) ?? 0;
  }

  ledgerKey(companyId: string, itemId: string): string {
    return `${companyId}:${itemId}`;
  }

  registerDevice(input: { companyId: string; userId: string; appVersion: string }): { id: string; status: string } {
    const id = `device-${randomBytes(4).toString('hex')}`;
    this.store.devices.set(id, { id, companyId: input.companyId, userId: input.userId, status: 'trusted', appVersion: input.appVersion });
    return { id, status: 'trusted' };
  }

  revokeDevice(deviceId: string): void {
    const device = this.store.devices.get(deviceId);
    if (device) device.status = 'revoked';
  }

}
