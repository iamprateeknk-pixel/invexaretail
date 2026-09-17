export const MIN_COUNT_REVIEW_NOTE = 5;
export const COUNT_MANAGER_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'];

export function isCountManager(role) {
  return COUNT_MANAGER_ROLES.includes(role);
}

export function countReviewNoteIsValid(value) {
  return String(value ?? '').trim().length >= MIN_COUNT_REVIEW_NOTE;
}

export function displayCountStatus(status) {
  const value = String(status ?? '');
  if (value === 'APPROVED' || value === 'Approved') return 'Approved';
  if (value === 'REJECTED' || value === 'Rejected') return 'Rejected';
  if (value === 'RECOUNT' || value === 'Recount') return 'Recount';
  if (value === 'ASSIGNED' || value === 'Assigned') return 'Assigned';
  return 'Pending review';
}

export function displayCountPriority(priority, overdue = false) {
  if (overdue || priority === 'HIGH' || priority === 'Urgent') return 'Urgent';
  if (priority === 'LOW' || priority === 'Low') return 'Low';
  return 'Normal';
}
