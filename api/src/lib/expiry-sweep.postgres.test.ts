// Audit S-3: the daily sweep marks lapsed AVAILABLE lots EXPIRED (status only, never quantity).
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { sweepExpiredLots } from './expiry-sweep.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('lapsed AVAILABLE lots become EXPIRED; today, future, undated and non-AVAILABLE lots are untouched; quantity never changes', async () => {
  const companyId = `sweep-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const item = await prisma.item.create({ data: { code: `SWP-${randomUUID().slice(0, 8)}`, name: 'Sweep item', companyId } });
  const now = new Date('2026-09-26T06:30:00Z'); // 12:00 IST on the 26th
  const mk = (lotNo: string, expiry: string | null, status = 'AVAILABLE') =>
    prisma.lot.create({ data: { itemId: item.id, lotNo, status, expiryDate: expiry ? new Date(expiry) : null } });
  const lapsed = await mk('LAPSED', '2026-09-20T00:00:00Z');
  const today = await mk('TODAY', '2026-09-26T00:00:00Z');
  const future = await mk('FUTURE', '2027-01-01T00:00:00Z');
  const undated = await mk('UNDATED', null);
  const blocked = await mk('BLOCKED', '2026-01-01T00:00:00Z', 'BLOCKED');
  const loc = await prisma.location.create({ data: { code: `swp-${randomUUID()}`, name: 'L', type: 'store', companyId } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lapsed.id, locationId: loc.id, onHand: 7, companyId } });

  const first = await sweepExpiredLots(now);
  assert.ok(first.expired >= 1);
  const status = async (id: string) => (await prisma.lot.findUniqueOrThrow({ where: { id } })).status;
  assert.equal(await status(lapsed.id), 'EXPIRED');
  assert.equal(await status(today.id), 'AVAILABLE', 'usable through its expiry date');
  assert.equal(await status(future.id), 'AVAILABLE');
  assert.equal(await status(undated.id), 'AVAILABLE');
  assert.equal(await status(blocked.id), 'BLOCKED', 'a manual block is never overwritten');
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { lotId: lapsed.id } })).onHand), 7, 'write-off stays a controlled human action');

  const second = await sweepExpiredLots(now);
  assert.equal(await status(lapsed.id), 'EXPIRED');
  assert.ok(second.expired <= first.expired, 'idempotent');
  const next = await sweepExpiredLots(new Date('2026-09-27T06:30:00Z'));
  assert.ok(next.expired >= 1);
  assert.equal(await status(today.id), 'EXPIRED', 'the day after its expiry date it lapses');
});

integration('the sweep judges each lot by its own company\'s timezone (audit T-2)', async () => {
  const mkCompany = async (timezone: string | null) => {
    const companyId = `sweeptz-co-${randomUUID()}`;
    await prisma.companyProfile.create({ data: { id: companyId, name: companyId, timezone } as never });
    const item = await prisma.item.create({ data: { code: `TZ-${randomUUID().slice(0, 8)}`, name: 'TZ item', companyId } });
    const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'L', expiryDate: new Date('2026-09-25T00:00:00Z') } });
    return lot.id;
  };
  const india = await mkCompany('Asia/Kolkata');
  const la = await mkCompany('America/Los_Angeles');
  // 02:00 UTC on the 26th: already the 26th in Kolkata, still the 25th in Los Angeles.
  await sweepExpiredLots(new Date('2026-09-26T02:00:00Z'));
  const status = async (id: string) => (await prisma.lot.findUniqueOrThrow({ where: { id } })).status;
  assert.equal(await status(india), 'EXPIRED');
  assert.equal(await status(la), 'AVAILABLE', 'the 25th is still usable in Los Angeles');
  await sweepExpiredLots(new Date('2026-09-26T08:00:00Z')); // 01:00 on the 26th in Los Angeles
  assert.equal(await status(la), 'EXPIRED');
});
