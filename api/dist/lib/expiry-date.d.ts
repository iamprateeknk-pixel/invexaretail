import { BUSINESS_TIMEZONE } from './timezone-context.js';
export { BUSINESS_TIMEZONE };
/** The calendar day (as a day number) an expiry value falls on, or null if it is missing/invalid. */
export declare function expiryDayNumber(expiry: string | Date | null | undefined): number | null;
/** Today's calendar day (as a day number) in the business timezone. */
export declare function todayDayNumber(now?: Date, timezone?: string): number;
/** Whole calendar days from today to the expiry date (0 = expires today, negative = already expired); null if undated. */
export declare function daysUntilExpiryDate(expiry: string | Date | null | undefined, now?: Date, timezone?: string): number | null;
/** True only when the expiry date is strictly before today. Undated lots are never "expired" (they are a data gap, flagged elsewhere). */
export declare function isExpiredOn(expiry: string | Date | null | undefined, now?: Date, timezone?: string): boolean;
