// Week 14: the background sweep that actually fixes the DomainEventOutbox
// unbounded-growth gap (see event-bus.ts's pruneDomainEventOutbox and
// docs/week14-outbox-retention.md). Same poll-loop shape as Week 11's
// lib/import-worker.ts.
import { pruneDomainEventOutbox } from './event-bus.js';

let pollTimer: NodeJS.Timeout | null = null;

export async function pruneOutboxOnce(): Promise<number> {
  return pruneDomainEventOutbox();
}

/** Starts a background poll loop. Once a day is plenty for a retention sweep - call `stopOutboxRetention()` to stop it (used in tests and graceful shutdown). */
export function startOutboxRetention(intervalMs = 24 * 60 * 60 * 1000): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    pruneOutboxOnce().catch((error) => console.error('[outbox-retention] prune failed', error));
  }, intervalMs);
  pollTimer.unref?.();
}

export function stopOutboxRetention(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
