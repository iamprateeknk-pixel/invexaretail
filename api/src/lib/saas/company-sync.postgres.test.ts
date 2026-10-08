// The platform company list used to know only the two seeded companies plus those created through the control
// plane, so a company that operates in the database (a CompanyProfile, or users carrying its companyId) never
// showed up for the super admin. syncOperationalCompanies() reads the database and registers the missing ones.
// DB-only - skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { controlPlane } from './control-plane.js';
import { syncOperationalCompanies } from './persistence.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration('companies that exist only in operational tables appear in the platform list, once, with their workspace name', async () => {
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  const withProfile = `sync-profile-${randomUUID()}`;
  const usersOnly = `sync-users-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: withProfile, name: 'Kota Fresh Mart' } });
  const userId = `sync-admin-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId: withProfile } });
  const otherUser = `sync-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: otherUser, name: 'Clerk', email: `${otherUser}@test.invexa.local`, passwordHash: 'x', role: 'STORE_USER', assignedLocations: '[]', companyId: usersOnly } });

  assert.equal(controlPlane.companies.has(withProfile), false);
  await syncOperationalCompanies();
  const named = controlPlane.companies.get(withProfile);
  assert.equal(named?.name, 'Kota Fresh Mart');
  assert.equal(named?.primaryAdminId, userId);
  assert.equal(controlPlane.companies.get(usersOnly)?.name, usersOnly, 'with no profile the id is the visible name rather than hiding the company');

  const before = controlPlane.companies.size;
  assert.equal(await syncOperationalCompanies(), 0, 'running it again changes nothing');
  assert.equal(controlPlane.companies.size, before);
});
