// Plan P1-PERF-002 / Area E WP3: "no user GET waits for a full repository refresh".
//
// The API still serves operational reads from an in-memory snapshot of the
// database. That snapshot used to be refreshed *inside* a user's GET once it was
// older than the interval, so one unlucky request paid for a full hydration (and
// every request queued behind it). The refresh now runs here, on a timer, off the
// request path:
//   - a single refresh at a time (a slow one is never overlapped);
//   - a failure keeps serving the last good snapshot and is counted, not thrown;
//   - health is exposed (`GET /ops/metrics`) so a snapshot that has stopped
//     updating is an alert, not a silent staleness.
// Domain events keep normal screens current; this reconciles direct database writes
// and anything another replica changed.
export type ReconcilerHealth = {
  running: boolean;
  intervalMs: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  /** Milliseconds since the snapshot was last confirmed fresh, or null if it never was. */
  ageMs: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** True when the snapshot is older than 3 intervals or 3 refreshes in a row failed. */
  stale: boolean;
};

export class RepositoryReconciler {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private lastSuccess: number | null = null;
  private lastAttempt: number | null = null;
  private failures = 0;
  private lastError: string | null = null;

  constructor(
    private readonly refresh: () => Promise<void>,
    readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Marks "the snapshot was just loaded" (startup hydration), so the first timer tick is a full interval away. */
  markFresh(): void {
    this.lastSuccess = this.now();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs one refresh unless one is already running (then it joins that one). Never throws. */
  runOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.lastAttempt = this.now();
    this.inFlight = (async () => {
      try {
        await this.refresh();
        this.lastSuccess = this.now();
        this.failures = 0;
        this.lastError = null;
      } catch (error) {
        this.failures += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
        console.warn('[reconciler] snapshot refresh failed; serving the last good snapshot.', this.lastError);
      }
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  health(): ReconcilerHealth {
    const now = this.now();
    const ageMs = this.lastSuccess === null ? null : now - this.lastSuccess;
    return {
      running: this.timer !== null,
      intervalMs: this.intervalMs,
      lastSuccessAt: this.lastSuccess === null ? null : new Date(this.lastSuccess).toISOString(),
      lastAttemptAt: this.lastAttempt === null ? null : new Date(this.lastAttempt).toISOString(),
      ageMs,
      consecutiveFailures: this.failures,
      lastError: this.lastError,
      stale: this.failures >= 3 || (ageMs !== null && ageMs > this.intervalMs * 3),
    };
  }
}

export function reconcileIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.DATABASE_REFRESH_INTERVAL_MS ?? 30_000);
  return Number.isFinite(configured) ? Math.max(5_000, configured) : 30_000;
}

let active: RepositoryReconciler | null = null;

/** The process-wide reconciler, registered at startup so /ops/metrics can report on it. */
export function setActiveReconciler(reconciler: RepositoryReconciler | null): void {
  active = reconciler;
}

export function activeReconcilerHealth(): ReconcilerHealth | null {
  return active ? active.health() : null;
}
