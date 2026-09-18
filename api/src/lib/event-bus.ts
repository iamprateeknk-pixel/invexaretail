import { randomUUID } from 'node:crypto';

// Blueprint v4 §11 / Appendix B: successful mutations publish a domain event;
// authorized web/mobile sessions receive it over an authenticated SSE stream
// and refetch only what changed instead of relying on manual refresh.

export const EVENT_TOPICS = [
  'stock.changed',
  'item.changed',
  'lot.changed',
  'count.changed',
  'assignment.changed',
  'campaign.changed',
  'transfer.changed',
  'pick.changed',
  'receipt.changed',
  'putaway.changed',
  'import.committed',
  'exception.changed',
  'approval.changed',
  'permission.changed',
  'config.changed',
  'connector.changed',
] as const;

export type EventTopic = (typeof EVENT_TOPICS)[number];

export type DomainEvent = {
  id: number;
  topic: EventTopic;
  companyId: string;
  // Locations the change touched. Omitted = company-wide (every location).
  locationIds?: string[];
  actorId?: string;
  requestId?: string;
  at: string;
};

export type EventSubscriber = {
  id: string;
  companyId: string;
  userId: string;
  // null = the user can see every location in the company (admin roles).
  locationIds: string[] | null;
  send: (event: DomainEvent) => void;
};

const BUFFER_MAX = 1000;
// Changes on every process start, so a client holding a cursor from before a
// restart knows the numeric ids no longer line up and must do a full resync.
export const SERVER_EPOCH = randomUUID();

let sequence = 0;
const buffer: DomainEvent[] = [];
const subscribers = new Map<string, EventSubscriber>();

export function canReceive(subscriber: Pick<EventSubscriber, 'companyId' | 'locationIds'>, event: DomainEvent): boolean {
  if (subscriber.companyId !== event.companyId) return false;
  if (!event.locationIds?.length || subscriber.locationIds === null) return true;
  return event.locationIds.some((locationId) => subscriber.locationIds!.includes(locationId));
}

export function publishEvent(input: Omit<DomainEvent, 'id' | 'at'>): DomainEvent {
  const event: DomainEvent = { ...input, id: ++sequence, at: new Date().toISOString() };
  buffer.push(event);
  if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
  for (const subscriber of subscribers.values()) {
    if (!canReceive(subscriber, event)) continue;
    try {
      subscriber.send(event);
    } catch {
      // A dead socket must never break the request that produced the event.
      subscribers.delete(subscriber.id);
    }
  }
  return event;
}

export function subscribe(subscriber: Omit<EventSubscriber, 'id'>): { id: string; unsubscribe: () => void } {
  const id = randomUUID();
  subscribers.set(id, { ...subscriber, id });
  return { id, unsubscribe: () => { subscribers.delete(id); } };
}

export function subscriberCount(): number {
  return subscribers.size;
}

export function latestEventId(): number {
  return sequence;
}

export type ReplayResult =
  | { kind: 'replay'; events: DomainEvent[] }
  // The cursor is unusable (older than the buffer, or from before a restart):
  // the client must refetch everything rather than trust a partial replay.
  | { kind: 'reset' };

export function eventsSince(
  lastEventId: number,
  subscriber: Pick<EventSubscriber, 'companyId' | 'locationIds'>,
  clientEpoch?: string,
): ReplayResult {
  if (clientEpoch && clientEpoch !== SERVER_EPOCH) return { kind: 'reset' };
  if (lastEventId > sequence) return { kind: 'reset' };
  const oldest = buffer[0]?.id ?? sequence + 1;
  if (lastEventId + 1 < oldest && lastEventId < sequence) return { kind: 'reset' };
  return { kind: 'replay', events: buffer.filter((event) => event.id > lastEventId && canReceive(subscriber, event)) };
}

export function resetEventBusForTests(): void {
  sequence = 0;
  buffer.length = 0;
  subscribers.clear();
}
