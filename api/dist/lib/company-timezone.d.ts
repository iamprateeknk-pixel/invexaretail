/** Loads every company's configured zone into the in-process cache (boot, and after a change). */
export declare function loadCompanyTimezones(): Promise<number>;
export declare function saveCompanyTimezone(companyId: string, timezone: string | null): Promise<string | null>;
