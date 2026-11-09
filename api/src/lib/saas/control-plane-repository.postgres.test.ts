// ULTRA P2: the control plane's row layer is the system of record, not the
// single ControlPlaneState JSON blob. These tests prove cross-replica
// behaviour with fresh ControlPlane instances sharing one database: a
// kill switch, an API key and a usage counter written on one instance must
// be visible to another instance through the rows alone.
// DB-only - skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { ControlPlane } from './control-plane.js';
import {
  controlPlaneDbEnabled,
  hydrateControlPlaneRows,
  incrementUsage,
  persistControlPlaneRows,
  refreshControlPlaneFromDb,
  refreshKillSwitchesFromDb,
  writeKillSwitchRow,
} from './control-plane-repository.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

function platformScope(plane: ControlPlane) {
  return plane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
}

function lockedScope(plane: ControlPlane, companyId = 'default-company') {
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const selected = plane.selectCompany(login.user.id, companyId);
  return plane.requireControlSession(selected.token).scope;
}

integration('kill switch written on one instance is seen by a fresh instance', async () => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  assert.equal(controlPlaneDbEnabled(), true);
  const feature = `TEST_KS_${randomUUID()}`;

  const writer = new ControlPlane();
  writer.setKillSwitch(platformScope(writer), feature, false, 'p2 test');
  await persistControlPlaneRows(writer);

  // A second replica booting from the rows sees the switch.
  const reader = new ControlPlane();
  assert.equal(await hydrateControlPlaneRows(reader), true);
  assert.equal(reader.safety.get(feature), false);
  assert.equal(reader.isFeatureEnabled('default-company', feature), false);

  // Read-through on a stale instance: no restart, no hydrate.
  const stale = new ControlPlane();
  assert.equal(stale.safety.get(feature), undefined);
  await refreshKillSwitchesFromDb(stale);
  assert.equal(stale.safety.get(feature), false);

  // The atomic row write is honoured by the same read-through.
  await writeKillSwitchRow(feature, true);
  await refreshKillSwitchesFromDb(stale);
  assert.equal(stale.safety.get(feature), true);

  await prisma.controlPlaneKillSwitch.delete({ where: { featureKey: feature } });
});

integration('api keys create/rotate/revoke round-trip across instances', async () => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const plane = new ControlPlane();
  const scope = lockedScope(plane);
  const created = plane.createApiKey(scope, 'p2-test-key', ['read']);
  await persistControlPlaneRows(plane);

  const reader = new ControlPlane();
  await hydrateControlPlaneRows(reader);
  const verified = await reader.verifyApiKeyFresh(created.token);
  assert.equal(verified?.companyId, 'default-company');
  assert.equal(verified?.id, created.id);
  assert.equal('hash' in (verified ?? {}), false, 'the hash never leaks into a public shape');

  const rotated = plane.rotateApiKey(scope, created.id);
  await persistControlPlaneRows(plane);

  const reader2 = new ControlPlane();
  await hydrateControlPlaneRows(reader2);
  await assert.rejects(() => reader2.verifyApiKeyFresh(created.token), /API key is revoked/);
  const verifiedNew = await reader2.verifyApiKeyFresh(rotated.token);
  assert.equal(verifiedNew?.id, rotated.id);

  reader2.revokeApiKey(scope, rotated.id);
  await persistControlPlaneRows(reader2);

  const reader3 = new ControlPlane();
  await hydrateControlPlaneRows(reader3);
  await assert.rejects(() => reader3.verifyApiKeyFresh(rotated.token), /API key is revoked/);
});

integration('usage counters increment atomically under concurrency', async () => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const companyId = `usage-${randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 20 }, () => incrementUsage(companyId, 'api_requests', 3)));
  assert.equal(Math.max(...results), 60, 'twenty concurrent increments of 3 sum to exactly 60');
  const row = await prisma.controlPlaneUsage.findUnique({
    where: { companyId_meter: { companyId, meter: 'api_requests' } },
  });
  assert.equal(row?.value, 60);

  const plane = new ControlPlane();
  const total = await plane.incrementUsage(companyId, 'api_requests', 5);
  assert.equal(total, 65);
  assert.equal(plane.usage.get(companyId)?.api_requests, 65, 'the in-memory map syncs to the database total');

  await prisma.controlPlaneUsage.delete({ where: { companyId_meter: { companyId, meter: 'api_requests' } } });
});

integration('a company survives a row round-trip and a remote status change converges on refresh', async () => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const plane = new ControlPlane();
  const scope = platformScope(plane);
  const adminEmail = `row-${randomUUID()}@test.invexa.local`;
  const { company } = plane.createCompany(scope, {
    name: 'Row Test Co',
    planId: 'starter',
    adminEmail,
    adminName: 'Row Tester',
  });
  await persistControlPlaneRows(plane);

  const reader = new ControlPlane();
  await hydrateControlPlaneRows(reader);
  const restored = reader.companies.get(company.id);
  assert.equal(restored?.name, 'Row Test Co');
  assert.equal(restored?.planId, 'starter');
  assert.equal(reader.companyUsers.get(company.primaryAdminId!)?.email, adminEmail);
  assert.equal(reader.entitlements.get(company.id)?.INVENTORY, true);
  assert.equal(reader.billing.get(company.id)?.subscription, 'trial');
  assert.equal(reader.published.get(company.id)?.status, 'published');

  plane.setCompanyStatus(scope, company.id, 'suspended', 'p2 test');
  await persistControlPlaneRows(plane);
  await refreshControlPlaneFromDb(reader);
  assert.equal(reader.companies.get(company.id)?.status, 'suspended');
});
