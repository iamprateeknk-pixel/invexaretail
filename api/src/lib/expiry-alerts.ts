import { daysUntilExpiryDate } from './expiry-date.js';

export type ExpirySeverity = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'UPCOMING';

/** Whole calendar days to expiry in the business timezone (see expiry-date.ts); Infinity when undated. */
export function daysUntilExpiry(expiryDate: Date, now = new Date()): number {
  return daysUntilExpiryDate(expiryDate, now) ?? Number.POSITIVE_INFINITY;
}

export function expirySeverity(days: number): ExpirySeverity {
  if (days < 0) return 'EXPIRED';
  if (days <= 7) return 'CRITICAL';
  if (days <= 30) return 'WARNING';
  return 'UPCOMING';
}

export function recommendedExpiryAction(days: number): string {
  if (!Number.isFinite(days)) return 'Add an expiry date before FEFO can allocate this lot.';
  if (days < 0) return 'Block sale and review controlled write-off.';
  if (days <= 7) return 'Transfer to a faster-selling branch or prioritise sale immediately.';
  if (days <= 30) return 'Prioritise FEFO and consider branch redistribution.';
  return 'Monitor under FEFO.';
}
