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
import { commitStudioRelease, requestStudioReview, studioDraftRevision } from './persistence.js';
import { readStudioRuntime, readStudioVersions } from './studio-versions.js';
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

integration('the same operator cannot approve a draft, and review survives a replica restart', async (t) => {
  const previous = process.env.REQUIRE_STUDIO_RELEASE_REVIEW;
  process.env.REQUIRE_STUDIO_RELEASE_REVIEW = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.REQUIRE_STUDIO_RELEASE_REVIEW;
    else process.env.REQUIRE_STUDIO_RELEASE_REVIEW = previous;
  });
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const makerPlane = new ControlPlane();
  await hydrateControlPlaneRows(makerPlane);
  const { company } = makerPlane.createCompany(platformScope(makerPlane), {
    name: 'Independent Studio Review', planId: 'pro', adminName: 'Review owner', adminEmail: `${randomUUID()}@test.invexa.local`,
  });
  const reviewerId = randomUUID();
  const email = `${reviewerId}@test.invexa.local`;
  makerPlane.platformUsers.set(reviewerId, { ...makerPlane.platformUsers.get('platform-super-1')!, id: reviewerId, email });
  await persistControlPlaneRows(makerPlane);
  const maker = lockedScope(makerPlane, company.id);
  makerPlane.setStockColumnLayout(maker, [{ key: 'item_code', label: 'First proposed label' }]);
  let revision = studioDraftRevision(makerPlane.drafts.get(company.id))!;
  await assert.rejects(commitStudioRelease(makerPlane, maker, { draftRevision: revision }), { code: 'STUDIO_REVIEW_REQUIRED' });
  const stale = await requestStudioReview(makerPlane, maker, revision);
  makerPlane.setStockColumnLayout(maker, [{ key: 'item_code', label: 'Final proposed label' }]);
  await assert.rejects(commitStudioRelease(makerPlane, maker, { draftRevision: revision, reviewId: stale.id }), { code: 'STUDIO_CONFIG_CONFLICT' });
  revision = studioDraftRevision(makerPlane.drafts.get(company.id))!;
  const review = await requestStudioReview(makerPlane, maker, revision);
  assert.notEqual(review.id, stale.id);
  const command = { draftRevision: revision, reviewId: review.id };
  await assert.rejects(commitStudioRelease(makerPlane, maker, command), { code: 'STUDIO_REVIEW_NOT_INDEPENDENT' });
  assert.deepEqual(await requestStudioReview(makerPlane, maker, revision), review);

  const checkerPlane = new ControlPlane();
  await hydrateControlPlaneRows(checkerPlane);
  const login = checkerPlane.platformLogin(email, checkerPlane.seedPassword);
  const checker = checkerPlane.requireControlSession(checkerPlane.selectCompany(login.user.id, company.id).token).scope;
  const published = await commitStudioRelease(checkerPlane, checker, command);
  assert.equal(published.releaseReview?.requestedBy, maker.actorId);
  assert.equal(published.releaseReview?.approvedBy, checker.actorId);
  assert.equal((await readStudioVersions(makerPlane, company.id)).active?.releaseReview?.id, review.id);
  const events = await prisma.domainEventOutbox.findMany({ where: { companyId: company.id, topic: 'config.changed' } });
  assert.deepEqual(events.map((event) => event.actorId), [checker.actorId]);
});

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

integration('two replicas cannot both publish different changes from the same Studio version', async () => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const first = new ControlPlane();
  const { company } = first.createCompany(platformScope(first), {
    name: 'Concurrent Studio Publishing', planId: 'pro', adminName: 'Studio Owner', adminEmail: `${randomUUID()}@test.invexa.local`,
  });
  await persistControlPlaneRows(first);
  const second = new ControlPlane();
  await hydrateControlPlaneRows(second);
  const a = lockedScope(first, company.id);
  const b = lockedScope(second, company.id);
  first.setStockColumnLayout(a, [{ key: 'item_code', label: 'First item label' }]);
  second.setStockColumnLayout(b, [{ key: 'item_code', label: 'Second item label' }]);
  const left = first.publish(a);
  const right = second.publish(b);
  const results = await Promise.allSettled([persistControlPlaneRows(first), persistControlPlaneRows(second)]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected?.reason.code, 'STUDIO_CONFIG_CONFLICT');
  const winner = results[0].status === 'fulfilled' ? left : right;
  const rows = await prisma.controlPlaneConfig.findMany({ where: { companyId: company.id } });
  assert.deepEqual(rows.filter((row) => row.kind === 'published').map((row) => row.versionId), [winner.id]);
  assert.equal(rows.filter((row) => row.kind === 'history' && row.version === winner.version).length, 1);
});

integration('a rejected Studio release leaves its draft intact and rollback creates immutable history', async () => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const first = new ControlPlane();
  const { company } = first.createCompany(platformScope(first), {
    name: 'Studio Release History', planId: 'pro', adminName: 'Studio Owner', adminEmail: `${randomUUID()}@test.invexa.local`,
  });
  await persistControlPlaneRows(first);
  const second = new ControlPlane();
  await hydrateControlPlaneRows(second);
  const a = lockedScope(first, company.id);
  const b = lockedScope(second, company.id);
  const original = first.published.get(company.id)!;
  first.setStockColumnLayout(a, [{ key: 'item_code', label: 'Released label' }]);
  second.setStockColumnLayout(b, [{ key: 'item_code', label: 'Unreleased label' }]);
  const unreleased = structuredClone(second.drafts.get(company.id));
  const winner = await commitStudioRelease(first, a, { draftRevision: studioDraftRevision(first.drafts.get(company.id))! });
  await assert.rejects(commitStudioRelease(second, b, { draftRevision: studioDraftRevision(unreleased)! }), { code: 'STUDIO_CONFIG_CONFLICT' });
  assert.deepEqual(second.drafts.get(company.id), unreleased);
  assert.equal(second.published.get(company.id)?.id, original.id);
  assert.ok(!second.audit.some((entry) => entry.companyId === company.id && entry.action === 'CONFIG_PUBLISHED'));
  await refreshControlPlaneFromDb(second);
  assert.equal(second.published.get(company.id)?.id, winner.id);
  assert.deepEqual(second.drafts.get(company.id), unreleased);
  await assert.rejects(commitStudioRelease(second, b, { draftRevision: studioDraftRevision(unreleased)! }), { code: 'STUDIO_CONFIG_CONFLICT' });

  const restored = await commitStudioRelease(first, a, { rollbackVersion: original.version });
  assert.equal(restored.version, winner.version + 1);
  assert.deepEqual(restored.page, original.page);
  const rows = await prisma.controlPlaneConfig.findMany({ where: { companyId: company.id } });
  assert.deepEqual(rows.filter((row) => row.kind === 'published').map((row) => row.versionId), [restored.id]);
  assert.deepEqual(new Set(rows.filter((row) => row.kind === 'history').map((row) => row.versionId)), new Set([original.id, winner.id, restored.id]));

  const restoredSecond = await commitStudioRelease(first, a, { rollbackVersion: winner.version, targetVersionId: winner.id,
    expectedActiveVersionId: restored.id, reason: 'Return to the second release' });
  const history = await readStudioVersions(second, company.id);
  assert.equal(history.active?.id, restoredSecond.id);
  assert.deepEqual(history.active?.page, winner.page);
  assert.deepEqual(history.versions.map((entry) => entry.version), [4, 3, 2, 1]);
  assert.notEqual(second.runtimeConfig(company.id).version, restoredSecond.version, 'the reader has not refreshed its snapshot');
  const runtime = await readStudioRuntime(second, company.id, 'STORE_USER');
  assert.equal(runtime.version, restoredSecond.version);
  assert.equal(runtime.page.columns.find((column) => column.key === 'item_code')?.label, 'Released label');
  await assert.rejects(readStudioRuntime(second, randomUUID(), 'STORE_USER'), { code: 'COMPANY_NOT_FOUND' });
  const foreignRuntime = await readStudioRuntime(second, 'default-company', 'STORE_USER');
  assert.ok(foreignRuntime.page.columns.every((column) => column.label !== 'Released label'));
  const events = await prisma.domainEventOutbox.findMany({ where: { companyId: company.id, topic: 'config.changed' }, orderBy: { id: 'asc' } });
  assert.deepEqual(events.map((event) => event.requestId), [winner.id, restored.id, restoredSecond.id]);
  assert.ok(events.every((event) => event.actorId === a.actorId));
  assert.deepEqual(await readStudioVersions(second, randomUUID()), { active: undefined, versions: [] });
  first.versions.get(company.id)!.find((entry) => entry.id === winner.id)!.page.title = 'Changed after release';
  await assert.rejects(persistControlPlaneRows(first), { code: 'STUDIO_CONFIG_CONFLICT' });
  const unchanged = await prisma.controlPlaneConfig.findUniqueOrThrow({ where: { versionId_kind: { versionId: winner.id, kind: 'history' } } });
  assert.deepEqual(unchanged.payload, winner);
});
