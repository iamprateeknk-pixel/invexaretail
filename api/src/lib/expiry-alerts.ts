export type ExpirySeverity = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'UPCOMING';

export function daysUntilExpiry(expiryDate: Date, now = new Date()): number {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(expiryDate);
  end.setUTCHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
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
