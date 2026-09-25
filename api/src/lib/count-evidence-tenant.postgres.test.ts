// ADR-002 negative coverage for count recommendations and evidence gates.
// A real Item/Location/rule belonging to company A must behave as absent
// when the same identifiers are evaluated under company B.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { getCountRecommendation } from './count-tolerance.js';
import { requireEvidenceForDamage } from './evidence-rules.js';
import type { TenantContext } from './tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function fixture(): Promise<{ ctx: TenantContext; itemId: string; locationId: string }> {
  const companyId = `rule-tenant-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `rule-user-${randomUUID()}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: 'Rule tenant user',
      email: `${userId}@test.invexa.local`,
      passwordHash: 'not-a-real-hash',
      role: 'ADMIN',
      assignedLocations: '[]',
      companyId,
    },
  });
  const item = await prisma.item.create({
    data: { code: `RULE-${randomUUID()}`, name: 'Rule item', category: 'HIGH_VALUE', companyId },
  });
  const location = await prisma.location.create({
    data: { code: `RULE-LOC-${randomUUID()}`, name: 'Rule location', type: 'STORE', companyId },
  });
  return {
    ctx: { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' },
    itemId: item.id,
    locationId: location.id,
  };
}

integration('count recommendations ignore another company item, counts and tolerance rules', async () => {
  const owner = await fixture();
  const other = await fixture();
  await prisma.toleranceRule.create({
    data: { label: 'Owner rule', percentThreshold: 1, active: true, createdById: owner.ctx.userId },
  });

  const hidden = await getCountRecommendation(other.ctx, {
    itemId: owner.itemId,
    locationId: owner.locationId,
    bookQty: 10,
    physicalQty: 8,
  });
  assert.equal(hidden, null);

  const own = await getCountRecommendation(owner.ctx, {
    itemId: owner.itemId,
    locationId: owner.locationId,
    bookQty: 10,
    physicalQty: 8,
  });
  assert.equal(own?.recommendRecount, true);
  assert.equal(own?.reason.includes('Owner rule'), true);
});

integration('evidence gates ignore another company item and evidence rules', async () => {
  const owner = await fixture();
  const other = await fixture();
  await prisma.evidenceRule.create({
    data: {
      label: 'Owner damage rule',
      triggerType: 'TRANSFER_RECEIVE_DAMAGE',
      quantityThreshold: 1,
      active: true,
      createdById: owner.ctx.userId,
    },
  });
  const input = {
    transferId: `transfer-${randomUUID()}`,
    triggerType: 'TRANSFER_RECEIVE_DAMAGE',
    itemId: owner.itemId,
    branchId: null,
    damagedQty: 5,
  };

  assert.deepEqual(await requireEvidenceForDamage(other.ctx, input), { blocked: false });
  const own = await requireEvidenceForDamage(owner.ctx, input);
  assert.equal(own.blocked, true);
  if (own.blocked) assert.match(own.reason, /Owner damage rule/);
});
