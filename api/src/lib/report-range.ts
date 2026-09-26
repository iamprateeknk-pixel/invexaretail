import { currentTimezone } from './timezone-context.js';
import { DEFAULT_CAMPAIGN_TIMEZONE, endOfLocalDayIso, isDateOnly, isValidTimezone, startOfLocalDayIso } from './stock-take-campaign.js';

// Guide Week 18: reports and exports must define timezone handling explicitly,
// and the UI and the export must resolve a date range identically. A date-only
// `from`/`to` is a *calendar day in the report timezone*: `from` is that day's
// first instant, `to` its last (inclusive). Comparing the bare string
// "2026-09-25" against an ISO timestamp silently dropped the whole last day.

export type ReportRangeInput = { from?: unknown; to?: unknown; timezone?: unknown };
export type ResolvedReportRange = { timezone: string; from?: string; to?: string };

export class ReportRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportRangeError';
  }
}

function resolveBound(value: unknown, edge: 'from' | 'to', timezone: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ReportRangeError(`${edge} must be a date (YYYY-MM-DD) or an ISO timestamp.`);
  if (isDateOnly(value)) return edge === 'from' ? startOfLocalDayIso(value, timezone) : endOfLocalDayIso(value, timezone);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new ReportRangeError(`${edge} must be a date (YYYY-MM-DD) or an ISO timestamp.`);
  return new Date(parsed).toISOString();
}

export function resolveReportRange(input: ReportRangeInput): ResolvedReportRange {
  const timezone = input.timezone === undefined || input.timezone === '' ? currentTimezone() : String(input.timezone);
  if (!isValidTimezone(timezone)) throw new ReportRangeError(`Unknown timezone "${timezone}". Use an IANA name such as Asia/Kolkata.`);
  const from = resolveBound(input.from, 'from', timezone);
  const to = resolveBound(input.to, 'to', timezone);
  if (from && to && from > to) throw new ReportRangeError('from must not be after to.');
  return { timezone, from, to };
}
