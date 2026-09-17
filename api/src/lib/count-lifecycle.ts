import type { AccessContext } from './inventory.js';
import { canAccessLocation } from './inventory.js';

export const MIN_COUNT_REVIEW_NOTE = 5;
export const COUNT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type CountPriority = (typeof COUNT_PRIORITIES)[number];
export type CountReviewStatus = 'APPROVED' | 'REJECTED' | 'RECOUNT';

const COUNT_MANAGERS: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'];

export function canManageCountWork(role: string): boolean {
  return COUNT_MANAGERS.includes(role);
}

export function parseCountReviewReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < MIN_COUNT_REVIEW_NOTE) {
    throw new Error(`A review note of at least ${MIN_COUNT_REVIEW_NOTE} characters is required.`);
  }
  return reason;
}

export function parseCountPriority(value: unknown): CountPriority {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!raw) return 'NORMAL';
  if (raw === 'URGENT') return 'HIGH';
  if ((COUNT_PRIORITIES as readonly string[]).includes(raw)) return raw as CountPriority;
  throw new Error('Priority must be LOW, NORMAL, or HIGH.');
}

export function parseOptionalDueDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error('Due date is invalid.');
  return date.toISOString();
}

export function parseCountReviewStatus(value: unknown): CountReviewStatus {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const status = raw === 'APPROVE' ? 'APPROVED' : raw === 'REJECT' ? 'REJECTED' : raw;
  if (!['APPROVED', 'REJECTED', 'RECOUNT'].includes(status)) {
    throw new Error('Review status must be APPROVED, REJECTED, or RECOUNT.');
  }
  return status as CountReviewStatus;
}

export function assertCountLocationAccess(context: AccessContext, locationId: string): void {
  if (!canAccessLocation(context, locationId)) {
    throw new Error('This user cannot manage counts at the selected location.');
  }
}

export function displayCountPriority(priority?: string, overdue = false): 'Urgent' | 'Normal' | 'Low' {
  if (overdue || priority === 'HIGH' || priority === 'Urgent') return 'Urgent';
  if (priority === 'LOW' || priority === 'Low') return 'Low';
  return 'Normal';
}
