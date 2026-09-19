import { DEFAULT_COMPANY_ID } from './saas/tenant-scope.js';
import { publishEvent } from './event-bus.js';
import { expireStaleReservations, retryBackorderedOrders } from './orders.js';
import { withDistributedLock } from './distributed-lock.js';

// Blueprint v4 §23: "Reservation expiry/backorder retry should be automatic
// and visible." Until now both ran only when somebody listed orders, so an
// abandoned reservation kept holding stock (and a backorder kept waiting for
// stock that had already arrived) until the next screen refresh. This sweeps
// on a timer and tells connected clients when something changed.

const INTERVAL_MS = 2 * 60 * 1000;
let running = false;

export type OrderSweepDeps = {
  expire: () => Promise<number>;
  retry: () => Promise<number>;
  announce: () => void;
};

const defaults: OrderSweepDeps = {
  expire: expireStaleReservations,
  retry: retryBackorderedOrders,
  announce: () => {
    publishEvent({ topic: 'stock.changed', companyId: DEFAULT_COMPANY_ID });
  },
};

/** One pass: expire first (frees stock), then retry backorders against what was freed and what arrived. */
export async function orderSweepTick(deps: OrderSweepDeps = defaults): Promise<{ expired: number; filled: number } | null> {
  if (running) return null;
  running = true;
  try {
    const outcome = await withDistributedLock('order-reservation-sweep', async () => ({ expired: await deps.expire(), filled: await deps.retry() }));
    if (outcome === null) return null;
    const { expired, filled } = outcome;
    if (expired || filled) {
      console.log(`[orders] sweep expired ${expired} reservation(s), filled ${filled} backorder(s)`);
      deps.announce();
    }
    return { expired, filled };
  } catch (error) {
    console.warn('[orders] sweep failed', error instanceof Error ? error.message : error);
    return null;
  } finally {
    running = false;
  }
}

export function startOrderScheduler(): () => void {
  const first = setTimeout(() => void orderSweepTick(), 20_000);
  const timer = setInterval(() => void orderSweepTick(), INTERVAL_MS);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
