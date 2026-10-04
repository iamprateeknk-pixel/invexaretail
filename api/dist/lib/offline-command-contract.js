"use strict";
// Week 12: the versioned offline command / conflict contract the mobile client
// (Week 16) implements. Pure and storage-free on purpose - the API route that
// consumes it supplies an `AppliedCommandStore`, so this file defines the
// protocol (what a command is, when it is a duplicate, when it conflicts)
// without deciding where results are persisted.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFLINE_COMMAND_TYPES = exports.OFFLINE_CONTRACT_VERSION = void 0;
exports.validateOfflineCommand = validateOfflineCommand;
exports.evaluateOfflineCommand = evaluateOfflineCommand;
exports.OFFLINE_CONTRACT_VERSION = 1;
exports.OFFLINE_COMMAND_TYPES = ['COUNT_SUBMIT', 'PICK_CONFIRM', 'RECEIVE_CONFIRM', 'PUTAWAY_CONFIRM'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateOfflineCommand(input) {
    if (!input || typeof input !== 'object')
        return { ok: false, message: 'Command must be an object.' };
    const c = input;
    const str = (k) => typeof c[k] === 'string' && c[k].trim() !== '';
    if (typeof c.contractVersion !== 'number')
        return { ok: false, message: 'contractVersion is required.' };
    if (!str('commandId') || !UUID.test(c.commandId))
        return { ok: false, message: 'commandId must be a UUID.' };
    if (!exports.OFFLINE_COMMAND_TYPES.includes(c.type))
        return { ok: false, message: 'Unsupported command type.' };
    for (const key of ['companyId', 'actorId', 'entityType', 'entityId']) {
        if (!str(key))
            return { ok: false, message: `${key} is required.` };
    }
    if (!Number.isInteger(c.baseVersion) || c.baseVersion < 0)
        return { ok: false, message: 'baseVersion must be a non-negative integer.' };
    if (!str('occurredAt') || Number.isNaN(Date.parse(c.occurredAt)))
        return { ok: false, message: 'occurredAt must be an ISO timestamp.' };
    if (!c.payload || typeof c.payload !== 'object' || Array.isArray(c.payload))
        return { ok: false, message: 'payload must be an object.' };
    return { ok: true, command: c };
}
/**
 * Decides the outcome of a command *before* it is applied. A duplicate returns
 * the original result and never re-applies (each command syncs exactly once);
 * a stale baseVersion is a visible conflict, never a silent overwrite.
 */
function evaluateOfflineCommand(input, caller, store) {
    const parsed = validateOfflineCommand(input);
    if (parsed.ok === false)
        return { status: 'REJECTED', code: 'INVALID_COMMAND', message: parsed.message };
    const command = parsed.command;
    if (command.contractVersion !== exports.OFFLINE_CONTRACT_VERSION) {
        return { status: 'REJECTED', code: 'CONTRACT_VERSION', message: `Unsupported contract version ${command.contractVersion}; server speaks ${exports.OFFLINE_CONTRACT_VERSION}.` };
    }
    // Tenant and actor come from the authenticated session, never from the payload.
    if (command.companyId !== caller.companyId || command.actorId !== caller.actorId) {
        return { status: 'REJECTED', code: 'TENANT_MISMATCH', message: 'Command does not belong to the authenticated session.' };
    }
    const prior = store.find(command.companyId, command.commandId);
    if (prior)
        return { status: 'DUPLICATE', entityVersion: prior.entityVersion, result: prior.result };
    const serverVersion = store.currentVersion(command.companyId, command.entityType, command.entityId);
    if (serverVersion > command.baseVersion)
        return { status: 'CONFLICT', serverVersion, baseVersion: command.baseVersion };
    return { status: 'READY', command };
}
