// Transfer picker assignment and the two notifications the transfer flow sends:
// the assigned picker hears about new work, and the destination store hears when
// goods leave the source. Notifications land in UserNotification, the inbox the
// web bell already reads (GET /notification-inbox).
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import type { EnhancedUserRecord } from './enterprise-repository.js';
import type { TransferRecord } from './repository.js';

// A picker can be (re)assigned while the work is still in the pick queue.
export const PICKER_ASSIGNABLE_STATUSES: readonly TransferRecord['status'][] = ['DRAFT', 'SUBMITTED', 'REQUESTED', 'PENDING_PICK', 'PICKING', 'PARTIAL'];

// Roles that work the destination store and must be told a transfer is on its way.
const RECEIVER_ROLES: readonly string[] = ['STORE_USER', 'BRANCH_MANAGER'];

type UserLike = Pick<EnhancedUserRecord, 'id' | 'companyId' | 'role' | 'locationIds' | 'status'>;

export function isEligiblePicker(user: UserLike | undefined, companyId: string, sourceLocationId: string): boolean {
  return Boolean(user
    && user.companyId === companyId
    && user.role === 'WAREHOUSE_PICKER'
    && user.status === 'active'
    && user.locationIds.includes(sourceLocationId));
}

// Unassigned transfers stay open to every picker at the source; an assigned one only to its picker.
export function pickerMayWork(transfer: Pick<TransferRecord, 'assignedPickerId'>, pickerId: string): boolean {
  return !transfer.assignedPickerId || transfer.assignedPickerId === pickerId;
}

export function transferReceiverIds(users: UserLike[], companyId: string, destinationLocationId: string): string[] {
  return users
    .filter((user) => user.companyId === companyId
      && user.status === 'active'
      && RECEIVER_ROLES.includes(user.role)
      && user.locationIds.includes(destinationLocationId))
    .map((user) => user.id);
}

export type NotificationInput = { companyId: string; userIds: string[]; title: string; body: string; type: string };
export type MemoryNotification = { id: string; companyId: string; userId: string; title: string; body: string; type: string; createdAt: string };

// Memory mode has no UserNotification table; keep what would have been written so tests can see it.
export const memoryNotifications: MemoryNotification[] = [];

export async function notifyUsers(input: NotificationInput): Promise<number> {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (!userIds.length) return 0;
  if (!databaseEnabled) {
    const createdAt = new Date().toISOString();
    for (const userId of userIds) {
      memoryNotifications.push({ id: `notice-${Math.random().toString(36).slice(2, 10)}`, companyId: input.companyId, userId, title: input.title, body: input.body, type: input.type, createdAt });
    }
    return userIds.length;
  }
  const result = await prisma.userNotification.createMany({
    data: userIds.map((userId) => ({ userId, companyId: input.companyId, title: input.title, body: input.body, type: input.type })),
  });
  return result.count;
}

// A failed notification must never undo or fail the stock movement that triggered it.
async function notifySafely(input: NotificationInput): Promise<void> {
  try {
    await notifyUsers(input);
  } catch (error) {
    console.error('[transfer-notification] failed', error instanceof Error ? error.message : error);
  }
}

export function notifyPickerAssigned(transfer: TransferRecord, companyId: string, sourceName: string, destinationName: string): Promise<void> {
  if (!transfer.assignedPickerId) return Promise.resolve();
  const units = transfer.lines.reduce((sum, line) => sum + line.quantity, 0);
  return notifySafely({
    companyId,
    userIds: [transfer.assignedPickerId],
    title: 'Transfer assigned to you for picking',
    body: `Transfer ${transfer.id}: ${transfer.lines.length} line(s), ${units} units from ${sourceName} to ${destinationName}.`,
    type: 'transfer.pick_assigned',
  });
}

export function notifyTransferDispatched(transfer: TransferRecord, companyId: string, users: UserLike[], sourceName: string): Promise<void> {
  const dispatch = transfer.dispatch;
  const vehicle = [dispatch?.carrier, dispatch?.vehicleNo, dispatch?.awb].filter(Boolean).join(' / ');
  const eta = dispatch?.expectedArrivalAt ? ` Expected ${new Date(dispatch.expectedArrivalAt).toLocaleDateString('en-IN')}.` : '';
  return notifySafely({
    companyId,
    userIds: transferReceiverIds(users, companyId, transfer.destinationLocationId),
    title: 'Transfer on its way - verify on arrival',
    body: `Transfer ${transfer.id} left ${sourceName}${transfer.cartonCount ? ` in ${transfer.cartonCount} carton(s)` : ''}${vehicle ? ` (${vehicle})` : ''}.${eta} Receive it with good, damaged and short quantities and your remarks.`,
    type: 'transfer.dispatched',
  });
}
