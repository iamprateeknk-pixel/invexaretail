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
export declare function replaceAuditEvents(input: AuditEvent[]): void;
export declare function recordAudit(input: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent;
export declare function listAuditEvents(): AuditEvent[];
