export declare const EVENT_TOPICS: readonly ["stock.changed", "item.changed", "lot.changed", "count.changed", "assignment.changed", "campaign.changed", "transfer.changed", "pick.changed", "receipt.changed", "putaway.changed", "import.committed", "exception.changed", "approval.changed", "permission.changed", "config.changed", "connector.changed"];
export type EventTopic = (typeof EVENT_TOPICS)[number];
export type DomainEvent = {
    id: number;
    topic: EventTopic;
    companyId: string;
    locationIds?: string[];
    actorId?: string;
    requestId?: string;
    at: string;
};
export type EventSubscriber = {
    id: string;
    companyId: string;
    userId: string;
    locationIds: string[] | null;
    send: (event: DomainEvent) => void;
};
export declare const SERVER_EPOCH: `${string}-${string}-${string}-${string}-${string}`;
export declare function canReceive(subscriber: Pick<EventSubscriber, 'companyId' | 'locationIds'>, event: DomainEvent): boolean;
type OutboxTxClient = {
    domainEventOutbox: {
        create: (args: {
            data: Record<string, unknown>;
        }) => Promise<unknown>;
    };
};
export declare function recordOutboxEventInTransaction(tx: OutboxTxClient, input: Omit<DomainEvent, 'id' | 'at'>): Promise<void>;
/** Local delivery is for memory mode. Database mode readers poll the durable outbox, including events from other replicas. */
export declare function publishEvent(input: Omit<DomainEvent, 'id' | 'at'>): DomainEvent;
export declare function subscribe(subscriber: Omit<EventSubscriber, 'id'>): {
    id: string;
    unsubscribe: () => void;
};
export declare function deliverPersistedEvent(event: DomainEvent): void;
export declare function subscriberCount(): number;
export declare function latestEventId(): number;
export type ReplayResult = {
    kind: 'replay';
    events: DomainEvent[];
} | {
    kind: 'reset';
};
export declare function eventsSince(lastEventId: number, subscriber: Pick<EventSubscriber, 'companyId' | 'locationIds'>, clientEpoch?: string): ReplayResult;
export declare function durableEventsSince(lastEventId: number, subscriber: Pick<EventSubscriber, 'companyId' | 'locationIds'>): Promise<DomainEvent[]>;
export declare function durableLatestEventId(): Promise<number>;
export declare function resetEventBusForTests(): void;
export declare const OUTBOX_RETENTION_DAYS = 7;
/** Deletes DomainEventOutbox rows older than the retention window. Returns the number of rows removed. */
export declare function pruneDomainEventOutbox(olderThanDays?: number): Promise<number>;
export {};
