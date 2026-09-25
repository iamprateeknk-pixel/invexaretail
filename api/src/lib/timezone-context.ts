// Per-company business timezone (audit T-2). "Today" for expiry, dashboards and reports must be the
// company's calendar day, not one hard-coded zone. Threading a timezone argument through every
// caller was the alternative; instead the authenticated request runs inside an AsyncLocalStorage
// scope carrying its company's zone, and the shared day maths default to it. Pure: no database here.
import { AsyncLocalStorage } from 'node:async_hooks';

export function validTimezone(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** Process-wide default: BUSINESS_TIMEZONE (IANA name) when set and valid, else Asia/Kolkata. */
export const BUSINESS_TIMEZONE = validTimezone(process.env.BUSINESS_TIMEZONE) ?? 'Asia/Kolkata';

const scope = new AsyncLocalStorage<string>();
const byCompany = new Map<string, string>();

/** Cache write (used by the loader and by the settings route after a save). Invalid zones clear the entry. */
export function cacheCompanyTimezone(companyId: string, timezone: string | null | undefined): void {
  const valid = validTimezone(timezone);
  if (valid) byCompany.set(companyId, valid); else byCompany.delete(companyId);
}

export function companyTimezone(companyId: string | null | undefined): string {
  return (companyId ? byCompany.get(companyId) : undefined) ?? BUSINESS_TIMEZONE;
}

/** The zone of the request being served, else the process default. */
export function currentTimezone(): string {
  return scope.getStore() ?? BUSINESS_TIMEZONE;
}

export function runWithCompanyTimezone<T>(companyId: string | null | undefined, fn: () => T): T {
  return scope.run(companyTimezone(companyId), fn);
}
