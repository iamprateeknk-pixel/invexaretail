import { randomUUID } from 'node:crypto';
import { databaseEnabled } from './persistence.js';
import { prisma } from './db.js';

export const EVENT_TOPICS = ['stock.changed','item.changed','lot.changed','count.changed','assignment.changed','campaign.changed','transfer.changed','pick.changed','receipt.changed','putaway.changed','import.committed','exception.changed','approval.changed','permission.changed','config.changed','connector.changed'] as const;
export type EventTopic = (typeof EVENT_TOPICS)[number];
export type DomainEvent = { id: number; topic: EventTopic; companyId: string; locationIds?: string[]; actorId?: string; requestId?: string; at: string };
export type EventSubscriber = { id: string; companyId: string; userId: string; locationIds: string[] | null; send: (event: DomainEvent) => void };

const BUFFER_MAX = 1000;
export const SERVER_EPOCH = randomUUID();
let sequence = 0;
const buffer: DomainEvent[] = [];
const subscribers = new Map<string, EventSubscriber>();

export function canReceive(subscriber: Pick<EventSubscriber, 'companyId' | 'locationIds'>, event: DomainEvent): boolean {
  if (subscriber.companyId !== event.companyId) return false;
  if (!event.locationIds?.length || subscriber.locationIds === null) return true;
  return event.locationIds.some((locationId) => subscriber.locationIds!.includes(locationId));
}

async function persistEvent(event: DomainEvent): Promise<void> {
  if (!databaseEnabled) return;
  await prisma.domainEventOutbox.create({
    data: {
      topic: event.topic,
      companyId: event.companyId,
      locationIds: event.locationIds?.length ? event.locationIds : undefined,
      actorId: event.actorId ?? null,
      requestId: event.requestId ?? null,
      occurredAt: new Date(event.at),
    },
  });
}

/** Local delivery is for memory mode. Database mode readers poll the durable outbox, including events from other replicas. */
export function publishEvent(input: Omit<DomainEvent, 'id' | 'at'>): DomainEvent {
  const event: DomainEvent = { ...input, id: ++sequence, at: new Date().toISOString() };
  buffer.push(event);
  if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
  if (databaseEnabled) {
    void persistEvent(event).catch((error) => console.error('[events] durable outbox write failed', error));
    return event;
  }
  for (const subscriber of subscribers.values()) {
    if (!canReceive(subscriber, event)) continue;
    try { subscriber.send(event); } catch { subscribers.delete(subscriber.id); }
  }
  return event;
}

export function subscribe(subscriber: Omit<EventSubscriber, 'id'>): { id: string; unsubscribe: () => void } {
  const id = randomUUID();
  subscribers.set(id, { ...subscriber, id });
  return { id, unsubscribe: () => { subscribers.delete(id); } };
}
export function subscriberCount(): number { return subscribers.size; }
export function latestEventId(): number { return sequence; }
export type ReplayResult = { kind: 'replay'; events: DomainEvent[] } | { kind: 'reset' };
export function eventsSince(lastEventId: number, subscriber: Pick<EventSubscriber, 'companyId' | 'locationIds'>, clientEpoch?: string): ReplayResult {
  if (clientEpoch && clientEpoch !== SERVER_EPOCH) return { kind: 'reset' };
  if (lastEventId > sequence) return { kind: 'reset' };
  const oldest = buffer[0]?.id ?? sequence + 1;
  if (lastEventId + 1 < oldest && lastEventId < sequence) return { kind: 'reset' };
  return { kind: 'replay', events: buffer.filter((event) => event.id > lastEventId && canReceive(subscriber, event)) };
}

function locations(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');
  if (typeof value !== 'string') return undefined;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : undefined; } catch { return undefined; }
}
export async function durableEventsSince(lastEventId: number, subscriber: Pick<EventSubscriber, 'companyId' | 'locationIds'>): Promise<DomainEvent[]> {
  if (!databaseEnabled) return eventsSince(lastEventId, subscriber).kind === 'replay' ? (eventsSince(lastEventId, subscriber) as { events: DomainEvent[] }).events : [];
  const rows = await prisma.domainEventOutbox.findMany({
    where: { id: { gt: BigInt(lastEventId) }, companyId: subscriber.companyId },
    orderBy: { id: 'asc' },
    take: 500,
  });
  return rows.map((row) => ({ id: Number(row.id), topic: row.topic as EventTopic, companyId: row.companyId, ...(locations(row.locationIds)?.length ? { locationIds: locations(row.locationIds) } : {}), ...(row.actorId ? { actorId: row.actorId } : {}), ...(row.requestId ? { requestId: row.requestId } : {}), at: new Date(row.occurredAt).toISOString() })).filter((event) => canReceive(subscriber, event));
}
export async function durableLatestEventId(): Promise<number> {
  if (!databaseEnabled) return latestEventId();
  const row = await prisma.domainEventOutbox.aggregate({ _max: { id: true } });
  return Number(row._max.id ?? 0);
}
export function resetEventBusForTests(): void { sequence = 0; buffer.length = 0; subscribers.clear(); }