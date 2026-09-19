import type { EventTopic } from './event-bus.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Rule = { test: RegExp; topics: EventTopic[] };

// First-match-wins would hide multi-effect routes (a transfer receipt changes
// the transfer, the receipt and stock), so every matching rule contributes.
const RULES: Rule[] = [
  { test: /^\/(stock-counts|counts)(\/|$)/, topics: ['count.changed'] },
  { test: /^\/stock-counts\/[^/]+\/review$/, topics: ['stock.changed'] },
  { test: /^\/(count-assignments|cycle-counts|stock-takes)(\/|$)/, topics: ['assignment.changed'] },
  { test: /^\/transfers(\/|$)/, topics: ['transfer.changed', 'stock.changed'] },
  { test: /^\/transfers\/[^/]+\/receive$/, topics: ['receipt.changed'] },
  { test: /^\/(pick-waves|picker-tasks|picker)(\/|$)/, topics: ['pick.changed', 'stock.changed'] },
  { test: /^\/(putaway-tasks|bins)(\/|$)|^\/locations\/[^/]+\/(bin-transfers|bins)$/, topics: ['putaway.changed', 'stock.changed'] },
  { test: /^\/(items\/[^/]+\/lots|lots)(\/|$)/, topics: ['lot.changed'] },
  { test: /^\/(items|import\/items|catalog)(\/|$)/, topics: ['item.changed'] },
  { test: /^\/imports\//, topics: ['import.committed', 'stock.changed'] },
  { test: /^\/stock-adjustments\//, topics: ['stock.changed'] },
  { test: /^\/stock-adjustments\/import\/commit$/, topics: ['import.committed'] },
  { test: /^\/(expiry-alerts|expiry-write-off)(\/|$)/, topics: ['stock.changed', 'lot.changed'] },
  { test: /^\/(orders|returns|shipments|jobs|asset-checkouts|qc-inspections)(\/|$)/, topics: ['stock.changed'] },
  { test: /^\/purchase-orders(\/|$)/, topics: ['stock.changed'] },
  { test: /^\/purchase-orders\/[^/]+\/receive$/, topics: ['receipt.changed'] },
  { test: /^\/exceptions(\/|$)/, topics: ['exception.changed'] },
  { test: /^\/approval-requests(\/|$)/, topics: ['approval.changed'] },
  { test: /^\/(approval-rules|evidence-rules|tolerance-rules|reorder-rules|qc-templates|saved-reports|saved-views|company)(\/|$)|^\/locations(\/[^/]+)?$/, topics: ['config.changed'] },
  { test: /^\/(users|admin\/(users|roles|permissions))(\/|$)/, topics: ['permission.changed'] },
  { test: /^\/(connectors|webhook-deliveries|webhook-subscriptions)(\/|$)/, topics: ['connector.changed'] },
];

/** Topics a successful mutation on this path should publish. Previews and reads publish nothing. */
export function topicsForMutation(method: string, path: string): EventTopic[] {
  if (!MUTATING.has(method.toUpperCase())) return [];
  if (/\/preview$/.test(path)) return [];
  const topics = new Set<EventTopic>();
  for (const rule of RULES) {
    if (rule.test.test(path)) rule.topics.forEach((topic) => topics.add(topic));
  }
  return [...topics];
}

/** Locations named by the request, so branch-scoped clients only hear about their own branches. */
export function locationIdsForMutation(path: string, body: unknown): string[] | undefined {
  const ids = new Set<string>();
  const fromPath = /^\/(?:locations|stock)\/([^/]+)/.exec(path);
  if (fromPath) ids.add(decodeURIComponent(fromPath[1]));
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['locationId', 'sourceLocationId', 'destinationLocationId']) {
      const value = record[key];
      if (typeof value === 'string' && value) ids.add(value);
    }
  }
  return ids.size ? [...ids] : undefined;
}
