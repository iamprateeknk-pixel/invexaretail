export type AuditEvent = {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

const events: AuditEvent[] = [];

export function replaceAuditEvents(input: AuditEvent[]): void {
  events.splice(0, events.length, ...input.map((event) => ({ ...event })));
}

export function recordAudit(input: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
  const event: AuditEvent = {
    ...input,
    id: `audit-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  events.unshift(event);
  return { ...event };
}

export function listAuditEvents(): AuditEvent[] {
  return events.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined }));
}
