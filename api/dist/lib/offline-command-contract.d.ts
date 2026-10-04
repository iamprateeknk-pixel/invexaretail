export declare const OFFLINE_CONTRACT_VERSION = 1;
export declare const OFFLINE_COMMAND_TYPES: readonly ["COUNT_SUBMIT", "PICK_CONFIRM", "RECEIVE_CONFIRM", "PUTAWAY_CONFIRM"];
export type OfflineCommandType = (typeof OFFLINE_COMMAND_TYPES)[number];
export type OfflineCommand = {
    contractVersion: number;
    commandId: string;
    type: OfflineCommandType;
    companyId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    baseVersion: number;
    occurredAt: string;
    payload: Record<string, unknown>;
};
export type CommandOutcome = {
    status: 'APPLIED';
    entityVersion: number;
    result?: unknown;
} | {
    status: 'DUPLICATE';
    entityVersion: number;
    result?: unknown;
} | {
    status: 'CONFLICT';
    serverVersion: number;
    baseVersion: number;
} | {
    status: 'REJECTED';
    code: 'CONTRACT_VERSION' | 'INVALID_COMMAND' | 'TENANT_MISMATCH';
    message: string;
};
export type AppliedCommandStore = {
    find(companyId: string, commandId: string): {
        entityVersion: number;
        result?: unknown;
    } | undefined;
    currentVersion(companyId: string, entityType: string, entityId: string): number;
};
export declare function validateOfflineCommand(input: unknown): {
    ok: true;
    command: OfflineCommand;
} | {
    ok: false;
    message: string;
};
/**
 * Decides the outcome of a command *before* it is applied. A duplicate returns
 * the original result and never re-applies (each command syncs exactly once);
 * a stale baseVersion is a visible conflict, never a silent overwrite.
 */
export declare function evaluateOfflineCommand(input: unknown, caller: {
    companyId: string;
    actorId: string;
}, store: AppliedCommandStore): CommandOutcome | {
    status: 'READY';
    command: OfflineCommand;
};
