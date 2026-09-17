export type ExpirySeverity = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'UPCOMING';
export declare function daysUntilExpiry(expiryDate: Date, now?: Date): number;
export declare function expirySeverity(days: number): ExpirySeverity;
export declare function recommendedExpiryAction(days: number): string;
