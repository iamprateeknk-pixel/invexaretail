import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { drainStudioAutomationRuns, enqueueStudioSchedules, listStudioAutomationRuns, retryStudioAutomationRun } from './studio-automation-worker.js';
import type { ScopeContext } from './control-plane.js';
import { scanStudioLowStock } from './low-stock-notification.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const now = new Date('2027-02-01T03:31:00Z');

async function fixture(withAdmin: boolean) {
  const companyId = `automation-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId, timezone: 'Asia/Kolkata' } });
  if (withAdmin) await prisma.user.create({ data: {
    companyId, name: 'Admin', email: `${companyId}@example.test`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]',
  } });
  const publish = (version: number, enabled: boolean, kind = 'published') => prisma.controlPlaneConfig.create({ data: {
    companyId, versionId: randomUUID(), version, kind, status: kind,
    payload: {
      publishedAt: '2027-02-01T01:00:00Z',
      automations: [{ key: 'reminder', name: 'Check the dashboard', enforce: enabled, trigger: 'schedule', expression: 'daily@09:00', actionKey: 'SEND_NOTIFICATION' }],
    },
  } });
  return { companyId, publish };
}

integration('low-stock notifications cover an observed shortage once, rearm after recovery and respect company scope', async () => {
  const { companyId } = await fixture(true);
  const other = await fixture(true);
  const location = await prisma.location.create({ data: { companyId, name: 'Store A', code: randomUUID(), type: 'store' } });
  const foreignLocation = await prisma.location.create({ data: { companyId: other.companyId, name: 'Store B', code: randomUUID(), type: 'store' } });
  const item = await prisma.item.create({ data: { companyId, code: randomUUID(), name: 'Rice' } });
  const stockLot = async (locationId: string, onHand: number) => {
    const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: randomUUID() } });
    return prisma.stockLedger.create({ data: { companyId, itemId: item.id, locationId, lotId: lot.id, onHand } });
  };
  const [ledger] = await Promise.all([stockLot(location.id, 2), stockLot(location.id, 4), stockLot(foreignLocation.id, 0)]);
  await prisma.reorderRule.createMany({ data: [location.id, foreignLocation.id].map((locationId) => ({
    companyId, itemId: item.id, locationId, minQty: 5,
  })) });
  const config = {
    companyId, versionId: randomUUID(), version: 3,
    payload: { automations: [{ key: 'low', name: 'Reorder reminder', enforce: true, trigger: 'event', expression: 'inventory.low_stock', actionKey: 'SEND_NOTIFICATION' }] },
  };
  const setOnHand = (onHand: number) => prisma.stockLedger.update({ where: { id: ledger.id, companyId }, data: { onHand } });
  await prisma.controlPlaneConfig.create({ data: { ...config, kind: 'draft', status: 'draft' } });
  await setOnHand(1);
  await scanStudioLowStock(now);
  assert.deepEqual(await listStudioAutomationRuns(companyId), []);
  await prisma.controlPlaneConfig.create({ data: { ...config, kind: 'published', status: 'published' } });
  await setOnHand(2);
  await scanStudioLowStock(now);
  assert.deepEqual(await listStudioAutomationRuns(companyId), [], 'both lots contribute to on-hand stock');
  await setOnHand(1);
  await Promise.all([scanStudioLowStock(now), scanStudioLowStock(now)]);
  await scanStudioLowStock(now);
  assert.equal((await listStudioAutomationRuns(companyId)).length, 1);
  await drainStudioAutomationRuns(now);
  const notices = await prisma.userNotification.findMany({ where: { companyId } });
  assert.deepEqual(notices.map(({ body }) => body), ['Rice at Store A has 5 on hand. The reorder minimum is 5.']);
  await setOnHand(2);
  await scanStudioLowStock(now);
  await setOnHand(0);
  await scanStudioLowStock(now);
  assert.equal((await listStudioAutomationRuns(companyId)).length, 2);
  await setOnHand(2);
  await drainStudioAutomationRuns(now);
  assert.deepEqual((await listStudioAutomationRuns(companyId)).map(({ status }) => status).sort(), ['CANCELLED', 'DELIVERED']);
  assert.deepEqual(await listStudioAutomationRuns(other.companyId), []);
});

integration('a published schedule sends one company-scoped notification under overlapping workers', async () => {
  const a = await fixture(true);
  const b = await fixture(true);
  await a.publish(1, true, 'draft');
  await b.publish(1, false);
  await enqueueStudioSchedules(now);
  assert.deepEqual(await listStudioAutomationRuns(a.companyId), []);
  await a.publish(1, true);
  await Promise.all([enqueueStudioSchedules(now), enqueueStudioSchedules(now)]);
  await Promise.all([drainStudioAutomationRuns(now), drainStudioAutomationRuns(now)]);
  await enqueueStudioSchedules(now);
  await drainStudioAutomationRuns(now);
  const [run] = await listStudioAutomationRuns(a.companyId);
  assert.equal(run.status, 'DELIVERED');
  assert.equal(run.attempts, 1);
  assert.equal(run.configVersion, 1);
  const notices = await prisma.userNotification.findMany({ where: { companyId: { in: [a.companyId, b.companyId] } } });
  assert.deepEqual(notices.map((notice) => [notice.companyId, notice.title]), [[a.companyId, 'Check the dashboard']]);
  assert.deepEqual(await listStudioAutomationRuns(b.companyId), []);
});

integration('failed notifications back off and become visible dead letters; a disabled run is cancelled', async () => {
  const failure = await fixture(false);
  const cancelled = await fixture(true);
  await failure.publish(1, true);
  await cancelled.publish(1, true);
  await enqueueStudioSchedules(now);
  await cancelled.publish(2, false);
  await drainStudioAutomationRuns(now);
  assert.equal((await listStudioAutomationRuns(cancelled.companyId))[0].status, 'CANCELLED');
  assert.equal((await listStudioAutomationRuns(failure.companyId))[0].attempts, 1);
  await drainStudioAutomationRuns(now);
  assert.equal((await listStudioAutomationRuns(failure.companyId))[0].attempts, 1);
  for (let i = 1; i <= 4; i += 1) {
    const retry = new Date(now.getTime() + (2 ** i - 1) * 60_000);
    await drainStudioAutomationRuns(retry);
  }
  const [dead] = await listStudioAutomationRuns(failure.companyId);
  assert.equal(dead.status, 'DEAD_LETTER');
  assert.equal(dead.attempts, 5);
  assert.equal(dead.failureCode, 'NO_ACTIVE_ADMINS');
  assert.equal(await prisma.userNotification.count({ where: { companyId: { in: [failure.companyId, cancelled.companyId] } } }), 0);

  const scope: ScopeContext = { companyId: failure.companyId, tenantId: 'platform', actorId: 'operator', actorType: 'platform',
    sessionType: 'control', companySessionId: 'session', role: 'ADMIN' };
  assert.ok(dead.finishedAt);
  const requeueAt = new Date(dead.finishedAt.getTime() + 60_000);
  assert.equal(await retryStudioAutomationRun({ ...scope, companyId: cancelled.companyId }, dead.id, dead.finishedAt, requeueAt), 'missing');
  assert.equal(await retryStudioAutomationRun({ ...scope, sessionType: 'platform' }, dead.id, dead.finishedAt, requeueAt), 'forbidden');
  assert.equal(await retryStudioAutomationRun(scope, dead.id, now, requeueAt), 'changed');
  await failure.publish(2, false);
  assert.equal(await retryStudioAutomationRun(scope, dead.id, dead.finishedAt, requeueAt), 'disabled');
  await failure.publish(3, true);
  await prisma.user.create({ data: { companyId: failure.companyId, name: 'Admin', email: `${failure.companyId}@example.test`,
    passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]' } });
  const replay = () => retryStudioAutomationRun(scope, dead.id, dead.finishedAt!, requeueAt);
  assert.deepEqual((await Promise.all([replay(), replay()])).sort(), ['changed', 'queued']);
  const audits = await prisma.controlPlaneAudit.findMany({ where: { companyId: failure.companyId, entityId: dead.id } });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorUserId, scope.actorId);
  assert.deepEqual(audits[0].before, { status: 'DEAD_LETTER', attempts: 5, failureCode: 'NO_ACTIVE_ADMINS', finishedAt: dead.finishedAt.toISOString() });
  await Promise.all([drainStudioAutomationRuns(requeueAt), drainStudioAutomationRuns(requeueAt)]);
  assert.equal((await listStudioAutomationRuns(failure.companyId))[0].status, 'DELIVERED');
  assert.equal(await prisma.userNotification.count({ where: { companyId: failure.companyId } }), 1);
  assert.equal(await replay(), 'changed');
});
