// DB-mode coverage for lib/saas/control-app-link.ts (linked Control Panel sign-in). Skipped unless
// TEST_DATABASE_URL is set; the HTTP flow in memory mode is routes/control-app-link.http.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { controlPlane } from './control-plane.js';
import { linkAppUser, linkStatus, linkedPlatformSession, unlinkAppUser } from './control-app-link.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

const appUser = (companyId = 'default-company') => ({ id: `link-test-${randomUUID()}`, companyId, role: 'ADMIN', status: 'active' });

integration('a link is stored as one row per app user, survives a re-link, and is gone after unlinking', async () => {
  controlPlane.reset();
  const user = appUser();
  await linkAppUser(user, 'superadmin@invexa.local', controlPlane.seedPassword);
  await linkAppUser(user, 'superadmin@invexa.local', controlPlane.seedPassword);
  const rows = await prisma.controlPanelAppLink.findMany({ where: { appUserId: user.id } });
  assert.equal(rows.length, 1, 'linking twice keeps one row');
  assert.equal(rows[0].platformUserId, 'platform-super-1');
  assert.equal(rows[0].companyId, user.companyId);
  assert.equal(JSON.stringify(rows[0]).includes(controlPlane.seedPassword), false, 'no credential is stored with the link');
  assert.equal((await linkStatus(user)).linked, true);
  assert.ok((await linkedPlatformSession(user)).token);

  assert.deepEqual(await unlinkAppUser(user), { removed: true });
  assert.equal(await prisma.controlPanelAppLink.count({ where: { appUserId: user.id } }), 0);
  await assert.rejects(linkedPlatformSession(user), /not linked/);
  assert.deepEqual(await unlinkAppUser(user), { removed: false }, 'unlinking twice is safe');
});

integration('a link made in one company does not work after the user is moved to another', async () => {
  controlPlane.reset();
  const user = appUser('default-company');
  await linkAppUser(user, 'superadmin@invexa.local', controlPlane.seedPassword);
  const moved = { ...user, companyId: 'company-jaipur' };
  assert.equal((await linkStatus(moved)).linked, false);
  await assert.rejects(linkedPlatformSession(moved), /not linked/);
  await unlinkAppUser(user);
});

integration('a wrong platform password stores nothing', async () => {
  controlPlane.reset();
  const user = appUser();
  await assert.rejects(linkAppUser(user, 'superadmin@invexa.local', 'wrong-password'), /Invalid credentials/);
  assert.equal(await prisma.controlPanelAppLink.count({ where: { appUserId: user.id } }), 0);
});
