// Week 12: the versioned offline command / conflict contract the mobile client
// (Week 16) implements. Pure and storage-free on purpose - the API route that
// consumes it supplies an `AppliedCommandStore`, so this file defines the
// protocol (what a command is, when it is a duplicate, when it conflicts)
// without deciding where results are persisted.

import { z } from 'zod';
import { pickExceptionSchema, pickSlipLineSchema, transferReceiptLineSchema } from './validation-schemas.js';

export const OFFLINE_CONTRACT_VERSION = 1;
export const OPERATIONAL_OFFLINE_COMMAND_VERSION = 2;

export const OFFLINE_COMMAND_TYPES = ['COUNT_SUBMIT', 'PICK_CONFIRM', 'RECEIVE_CONFIRM', 'PUTAWAY_CONFIRM'] as const;
export type OfflineCommandType = (typeof OFFLINE_COMMAND_TYPES)[number];

const opaqueRevision = z.string().regex(/^[a-f0-9]{64}$/);
const resourceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/);
const baseOperationalCommand = z.object({
  contractVersion: z.literal(OPERATIONAL_OFFLINE_COMMAND_VERSION),
  commandId: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  entityId: resourceId,
  permit: z.string().min(1).max(2_048),
});

export const operationalOfflineCommandSchema = z.discriminatedUnion('type', [
  baseOperationalCommand.extend({
    type: z.literal('COUNT_SUBMIT'),
    revision: opaqueRevision,
    payload: z.discriminatedUnion('mode', [
      z.object({ locationId: resourceId, mode: z.literal('weight'), totalQuantity: z.number().min(0) }),
      z.object({ locationId: resourceId, mode: z.enum(['scan', 'manual']), lotNo: z.string().optional(), physicalQuantity: z.number().min(0) }),
    ]),
  }).strict(),
  baseOperationalCommand.extend({
    type: z.literal('PICK_CONFIRM'),
    revision: opaqueRevision,
    payload: z.object({
      lines: z.array(pickSlipLineSchema).optional(), exceptions: z.array(pickExceptionSchema).optional(),
      finished: z.boolean().optional(), startedAt: z.string().optional(),
    }),
  }).strict(),
  baseOperationalCommand.extend({
    type: z.literal('RECEIVE_CONFIRM'),
    revision: opaqueRevision,
    payload: z.object({
      lines: z.array(transferReceiptLineSchema).min(1), notes: z.string().optional(),
      qcInspections: z.array(z.object({
        itemId: z.string().optional(), lineId: z.string().optional(), results: z.record(z.string(), z.unknown()).nullable().optional(),
      })).optional(),
    }),
  }).strict(),
  baseOperationalCommand.extend({
    type: z.literal('PUTAWAY_CONFIRM'),
    revision: z.iso.datetime(),
    payload: z.object({ scannedBinCode: z.string().trim().min(1) }),
  }).strict(),
]);

export function operationalReplayRequest(command: z.infer<typeof operationalOfflineCommandSchema>) {
  const { commandId, entityId, revision, permit, payload } = command;
  // Route and identity-bearing fields are derived here, never read from a client-selected URL.
  switch (command.type) {
    case 'COUNT_SUBMIT':
      return { path: command.payload.mode === 'weight' ? '/stock-counts/weight' : '/stock-counts',
        body: { ...payload, itemId: entityId, requestId: commandId, stockRevision: revision, offlineCountPermit: permit } };
    case 'PICK_CONFIRM':
      return { path: `/picker/transfers/${entityId}/pick-slips`,
        body: { ...payload, requestId: commandId, pickRevision: revision, offlinePermit: permit } };
    case 'RECEIVE_CONFIRM':
      return { path: `/transfers/${entityId}/receive`,
        body: { ...payload, requestId: commandId, receiveRevision: revision, offlinePermit: permit } };
    case 'PUTAWAY_CONFIRM':
      return { path: `/putaway-tasks/${entityId}/confirm`,
        body: { ...payload, requireScan: true, taskRevision: revision, offlinePermit: permit } };
  }
}

export type OfflineCommand = {
  contractVersion: number;
  // Client-generated UUID; doubles as the idempotency key. A retry re-sends the same id.
  commandId: string;
  type: OfflineCommandType;
  companyId: string;
  actorId: string;
  // Entity the command mutates, and the version the device last saw. The server
  // rejects the command as a conflict when its current version is newer.
  entityType: string;
  entityId: string;
  baseVersion: number;
  // ISO time the action happened on the device (informational; never trusted for ordering).
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type CommandOutcome =
  | { status: 'APPLIED'; entityVersion: number; result?: unknown }
  | { status: 'DUPLICATE'; entityVersion: number; result?: unknown }
  | { status: 'CONFLICT'; serverVersion: number; baseVersion: number }
  | { status: 'REJECTED'; code: 'CONTRACT_VERSION' | 'INVALID_COMMAND' | 'TENANT_MISMATCH'; message: string };

export type AppliedCommandStore = {
  find(companyId: string, commandId: string): { entityVersion: number; result?: unknown } | undefined;
  currentVersion(companyId: string, entityType: string, entityId: string): number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateOfflineCommand(input: unknown): { ok: true; command: OfflineCommand } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') return { ok: false, message: 'Command must be an object.' };
  const c = input as Record<string, unknown>;
  const str = (k: string) => typeof c[k] === 'string' && (c[k] as string).trim() !== '';
  if (typeof c.contractVersion !== 'number') return { ok: false, message: 'contractVersion is required.' };
  if (!str('commandId') || !UUID.test(c.commandId as string)) return { ok: false, message: 'commandId must be a UUID.' };
  if (!OFFLINE_COMMAND_TYPES.includes(c.type as OfflineCommandType)) return { ok: false, message: 'Unsupported command type.' };
  for (const key of ['companyId', 'actorId', 'entityType', 'entityId']) {
    if (!str(key)) return { ok: false, message: `${key} is required.` };
  }
  if (!Number.isInteger(c.baseVersion) || (c.baseVersion as number) < 0) return { ok: false, message: 'baseVersion must be a non-negative integer.' };
  if (!str('occurredAt') || Number.isNaN(Date.parse(c.occurredAt as string))) return { ok: false, message: 'occurredAt must be an ISO timestamp.' };
  if (!c.payload || typeof c.payload !== 'object' || Array.isArray(c.payload)) return { ok: false, message: 'payload must be an object.' };
  return { ok: true, command: c as unknown as OfflineCommand };
}

/**
 * Decides the outcome of a command *before* it is applied. A duplicate returns
 * the original result and never re-applies (each command syncs exactly once);
 * a stale baseVersion is a visible conflict, never a silent overwrite.
 */
export function evaluateOfflineCommand(
  input: unknown,
  caller: { companyId: string; actorId: string },
  store: AppliedCommandStore,
): CommandOutcome | { status: 'READY'; command: OfflineCommand } {
  const parsed = validateOfflineCommand(input);
  if (parsed.ok === false) return { status: 'REJECTED', code: 'INVALID_COMMAND', message: parsed.message };
  const command = parsed.command;
  if (command.contractVersion !== OFFLINE_CONTRACT_VERSION) {
    return { status: 'REJECTED', code: 'CONTRACT_VERSION', message: `Unsupported contract version ${command.contractVersion}; server speaks ${OFFLINE_CONTRACT_VERSION}.` };
  }
  // Tenant and actor come from the authenticated session, never from the payload.
  if (command.companyId !== caller.companyId || command.actorId !== caller.actorId) {
    return { status: 'REJECTED', code: 'TENANT_MISMATCH', message: 'Command does not belong to the authenticated session.' };
  }
  const prior = store.find(command.companyId, command.commandId);
  if (prior) return { status: 'DUPLICATE', entityVersion: prior.entityVersion, result: prior.result };
  const serverVersion = store.currentVersion(command.companyId, command.entityType, command.entityId);
  if (serverVersion > command.baseVersion) return { status: 'CONFLICT', serverVersion, baseVersion: command.baseVersion };
  return { status: 'READY', command };
}
