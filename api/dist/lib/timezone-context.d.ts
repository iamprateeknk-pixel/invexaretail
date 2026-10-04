export declare function validTimezone(value: string | null | undefined): string | null;
/** Process-wide default: BUSINESS_TIMEZONE (IANA name) when set and valid, else Asia/Kolkata. */
export declare const BUSINESS_TIMEZONE: string;
/** Cache write (used by the loader and by the settings route after a save). Invalid zones clear the entry. */
export declare function cacheCompanyTimezone(companyId: string, timezone: string | null | undefined): void;
export declare function companyTimezone(companyId: string | null | undefined): string;
/** The zone of the request being served, else the process default. */
export declare function currentTimezone(): string;
export declare function runWithCompanyTimezone<T>(companyId: string | null | undefined, fn: () => T): T;
