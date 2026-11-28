import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOfflineCommand, OFFLINE_CONTRACT_VERSION, OPERATIONAL_OFFLINE_COMMAND_VERSION,
  operationalOfflineCommandSchema, operationalReplayRequest, type AppliedCommandStore } from './offline-command-contract.js';

const caller = { companyId: 'c1', actorId: 'u1' };
const command = (over: Record<string, unknown> = {}) => ({
  contractVersion: OFFLINE_CONTRACT_VERSION,
  commandId: '3f8f1c1e-6a53-4d6c-9d1e-0a1b2c3d4e5f',
  type: 'COUNT_SUBMIT', companyId: 'c1', actorId: 'u1',
  entityType: 'count', entityId: 'k1', baseVersion: 2,
  occurredAt: '2026-09-25T10:00:00Z', payload: { qty: 4 }, ...over,
});
const store = (version: number, applied = new Map<string, { entityVersion: number }>()): AppliedCommandStore => ({
  find: (company, id) => applied.get(`${company}:${id}`),
  currentVersion: () => version,
});
const code = (out: unknown) => (out as { code: string }).code;

test('a fresh command at the current version is ready to apply', () => {
  assert.equal(evaluateOfflineCommand(command(), caller, store(2)).status, 'READY');
});

test('a retried command returns the original result and is never re-applied', () => {
  const applied = new Map([[`c1:${command().commandId}`, { entityVersion: 3 }]]);
  assert.deepEqual(evaluateOfflineCommand(command(), caller, store(3, applied)), { status: 'DUPLICATE', entityVersion: 3, result: undefined });
});

test('a stale base version is a visible conflict, not an overwrite', () => {
  assert.deepEqual(evaluateOfflineCommand(command({ baseVersion: 1 }), caller, store(2)), { status: 'CONFLICT', serverVersion: 2, baseVersion: 1 });
});

test('tenant/actor come from the session; other contract versions and malformed input are rejected', () => {
  assert.equal(code(evaluateOfflineCommand(command({ companyId: 'c2' }), caller, store(2))), 'TENANT_MISMATCH');
  assert.equal(code(evaluateOfflineCommand(command({ actorId: 'u2' }), caller, store(2))), 'TENANT_MISMATCH');
  assert.equal(code(evaluateOfflineCommand(command({ contractVersion: 99 }), caller, store(2))), 'CONTRACT_VERSION');
  for (const bad of [null, command({ commandId: 'nope' }), command({ type: 'X' }), command({ baseVersion: -1 }), command({ payload: [] }), command({ occurredAt: 'x' })]) {
    assert.equal(code(evaluateOfflineCommand(bad, caller, store(2))), 'INVALID_COMMAND');
  }
});

test('operational replay selects the fixed domain route and keeps the permit and revision', () => {
  const hash = 'a'.repeat(64);
  const base = { contractVersion: OPERATIONAL_OFFLINE_COMMAND_VERSION, commandId: 'req-offline-1',
    entityId: 'entity-1', revision: hash, permit: 'permit' };
  const commands = [
    { type: 'COUNT_SUBMIT', payload: { mode: 'weight', locationId: 'location-1', totalQuantity: 2 } },
    { type: 'COUNT_SUBMIT', payload: { mode: 'scan', locationId: 'location-1', physicalQuantity: 2 } },
    { type: 'PICK_CONFIRM', payload: { lines: [{ itemId: 'item-1', quantity: 2 }] } },
    { type: 'RECEIVE_CONFIRM', payload: { lines: [{ itemId: 'item-1', lotId: 'lot-1', receivedQty: 2 }] } },
    { type: 'PUTAWAY_CONFIRM', revision: '2026-11-01T10:00:00Z', payload: { scannedBinCode: 'BIN-1' } },
  ];
  const paths = ['/stock-counts/weight', '/stock-counts', '/picker/transfers/entity-1/pick-slips',
    '/transfers/entity-1/receive', '/putaway-tasks/entity-1/confirm'];
  const revisionFields = ['stockRevision', 'stockRevision', 'pickRevision', 'receiveRevision', 'taskRevision'] as const;
  for (const [i, input] of commands.entries()) {
    const parsed = operationalOfflineCommandSchema.parse({ ...base, ...input });
    const replay = operationalReplayRequest(parsed);
    const body = replay.body as Record<string, unknown>;
    assert.equal(replay.path, paths[i]);
    assert.equal(body[revisionFields[i]], parsed.revision);
    assert.equal(body.offlineCountPermit ?? body.offlinePermit, base.permit);
    if (parsed.type !== 'PUTAWAY_CONFIRM') assert.equal(body.requestId, base.commandId);
  }
  assert.equal(operationalOfflineCommandSchema.safeParse({ ...base, ...commands[0], entityId: 'not/a-segment' }).success, false);
  assert.equal(operationalOfflineCommandSchema.safeParse({ ...base, ...commands[0], companyId: 'foreign' }).success, false);
  assert.equal(operationalOfflineCommandSchema.safeParse({ ...base, ...commands[0], permit: '' }).success, false);
});
