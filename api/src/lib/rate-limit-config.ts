// Phase 6: the general API limiter is per client IP. A whole store or warehouse
// often sits behind one NAT address, so a fixed 240 requests/minute can
// throttle a busy branch (and makes load testing impossible). The default is
// unchanged; operators can raise it with API_RATE_LIMIT_PER_MINUTE.
export const DEFAULT_API_RATE_LIMIT_PER_MINUTE = 240;
const MAX_API_RATE_LIMIT_PER_MINUTE = 1_000_000;

export function apiRateLimitPerMinute(env: Record<string, string | undefined> = process.env): number {
  const raw = env.API_RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw) return DEFAULT_API_RATE_LIMIT_PER_MINUTE;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return DEFAULT_API_RATE_LIMIT_PER_MINUTE;
  return Math.min(value, MAX_API_RATE_LIMIT_PER_MINUTE);
}
