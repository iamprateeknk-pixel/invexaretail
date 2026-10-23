import { Prisma } from '@prisma/client';
import { replaceContents } from './array-utils.js';
import { prisma, resolveDatabaseUrl } from './db.js';

// Mirrors persistence.ts's databaseEnabled: the API serves either from
// Postgres or (demo mode) from memory alone.
const databaseEnabled = Boolean(resolveDatabaseUrl());
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
  replaceContents(events, input.map((event) => ({ ...event })));
}

function persistAuditEvent(event: AuditEvent): void {
  try {
    prisma.auditLog
      .upsert({
        where: { id: event.id },
        update: { action: event.action, metadata: event.metadata as Prisma.InputJsonValue },
        create: {
          id: event.id,
          actorId: event.actorId,
          actorRole: event.actorRole,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          metadata: event.metadata as Prisma.InputJsonValue,
          createdAt: new Date(event.createdAt),
        },
      })
      .catch((error) => {
        console.error('audit persist failed:', error instanceof Error ? error.message : error);
      });
  } catch (error) {
    console.error('audit persist failed:', error instanceof Error ? error.message : error);
  }
}

export function recordAudit(input: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
  const event: AuditEvent = {
    ...input,
    id: `audit-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  events.unshift(event);
  // The AuditLog table is the audit record; the in-memory array is only a
  // read cache for this process. recordAudit stays synchronous for its many
  // callers, so the write is fire-and-forget, but in database mode it is
  // ALWAYS attempted (previously only callers that separately remembered
  // persistAudit() ever reached the database, so audit trails silently
  // depended on which route recorded them). Upsert by id makes this converge
  // with persistAudit() on the same single row when both run.
  if (databaseEnabled) persistAuditEvent(event);
  return { ...event };
}

export function listAuditEvents(): AuditEvent[] {
  return events.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined }));
}
