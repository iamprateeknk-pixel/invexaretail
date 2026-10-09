export const TRANSFER_MANAGER_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'];
export const TRANSFER_CREATOR_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER'];

export function canManageTransferDispatch(role) {
  return TRANSFER_MANAGER_ROLES.includes(role);
}

export function canCreateTransfer(role) {
  return TRANSFER_CREATOR_ROLES.includes(role);
}

export function isReceivableStatus(status) {
  return ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED'].includes(String(status ?? ''));
}

// Mirrors the API's PICKER_ASSIGNABLE_STATUSES: a picker can be (re)assigned until picking is finished.
export const PICKER_ASSIGNABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'REQUESTED', 'PENDING_PICK', 'PICKING', 'PARTIAL'];

export function transferQueueActions(role, status) {
  const manager = canManageTransferDispatch(role);
  const operationalAdmin = ['ADMIN', 'ADMIN_USER'].includes(role);
  return {
    assignPicker: manager && PICKER_ASSIGNABLE_STATUSES.includes(status),
    confirm: operationalAdmin && ['READY_FOR_ADMIN', 'PARTIAL'].includes(status),
    dispatch: manager && status === 'CONFIRMED',
    inTransit: manager && status === 'DISPATCHED',
    receive: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER'].includes(role) && isReceivableStatus(status),
    reject: manager && ['REQUESTED', 'PICKED'].includes(status),
  };
}
