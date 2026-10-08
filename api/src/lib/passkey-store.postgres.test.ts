// DB-mode coverage for lib/passkey-store.ts (Passkeys / WebAuthn). Skipped unless TEST_DATABASE_URL is set; run it
// directly against a real Postgres (the in-memory paths are covered by routes/passkeys-auth.http.test.ts).
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { addPasskey, deletePasskey, findPasskeyByCredentialId, listPasskeys, recordPasskeyUse } from './passkey-store.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function makeUser() {
  const id = `pk-test-${randomUUID()}`;
  await prisma.user.create({
    data: { id, name: 'Passkey Test User', email: `${id}@test.invexa.local`, passwordHash: 'not-a-real-hash', role: 'ADMIN', assignedLocations: '[]' },
  });
  return id;
}

const newKey = (userId: string) => ({ userId, credentialId: `cred-${randomUUID()}`, publicKey: new Uint8Array([1, 2, 3, 4, 5]), counter: 0, transports: ['internal'], deviceName: 'Laptop' });

integration('a passkey round-trips (key bytes intact) and a credential id belongs to one account', async () => {
  const userId = await makeUser();
  const input = newKey(userId);
  const saved = await addPasskey(input);
  assert.ok(saved);
  const found = await findPasskeyByCredentialId(input.credentialId);
  assert.deepEqual([...found!.publicKey], [1, 2, 3, 4, 5]);
  assert.deepEqual(found!.transports, ['internal']);
  assert.equal((await listPasskeys(userId)).length, 1);

  const otherUser = await makeUser();
  assert.equal(await addPasskey({ ...input, userId: otherUser }), null, 'the same credential id cannot be added to a second account');
});

integration('two simultaneous assertions with the same counter: exactly one wins', async () => {
  const userId = await makeUser();
  const saved = (await addPasskey(newKey(userId)))!;
  const results = await Promise.all([recordPasskeyUse(saved, 7), recordPasskeyUse(saved, 7)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await findPasskeyByCredentialId(saved.credentialId))!.counter, 7);
});

integration('a counter that does not move forward is refused (cloned authenticator); a counterless key at 0 is accepted', async () => {
  const userId = await makeUser();
  const saved = (await addPasskey({ ...newKey(userId), counter: 5 }))!;
  assert.equal(await recordPasskeyUse(saved, 5), false);
  assert.equal(await recordPasskeyUse(saved, 3), false);
  assert.equal(await recordPasskeyUse(saved, 6), true);

  const counterless = (await addPasskey(newKey(userId)))!;
  assert.equal(await recordPasskeyUse(counterless, 0), true);
});

integration('delete is scoped to the owner, and deleting the user cascades to their passkeys', async () => {
  const owner = await makeUser();
  const stranger = await makeUser();
  const saved = (await addPasskey(newKey(owner)))!;
  assert.equal(await deletePasskey(stranger, saved.id), false);
  assert.ok(await findPasskeyByCredentialId(saved.credentialId));
  await prisma.user.delete({ where: { id: owner } });
  assert.equal(await findPasskeyByCredentialId(saved.credentialId), null);
});
