"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceAuditEvents = replaceAuditEvents;
exports.recordAudit = recordAudit;
exports.listAuditEvents = listAuditEvents;
const events = [];
function replaceAuditEvents(input) {
    events.splice(0, events.length, ...input.map((event) => ({ ...event })));
}
function recordAudit(input) {
    const event = {
        ...input,
        id: `audit-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date().toISOString(),
    };
    events.unshift(event);
    return { ...event };
}
function listAuditEvents() {
    return events.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined }));
}
