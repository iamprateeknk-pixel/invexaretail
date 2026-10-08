// Passkeys (WebAuthn) end to end over HTTP in memory mode, against a software authenticator that builds real
// attestation/assertion bytes (EC P-256, "none" attestation) so @simplewebauthn/server does genuine verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { hashPassword } from '../lib/otp-auth.js';
import { createEnhancedUser, findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import enterpriseAuthRouter from './enterprise-auth.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { resetPasskeysForTests } from '../lib/passkey-store.js';

const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
const RP_ID = 'app.invexa.test';
const ORIGIN = 'https://app.invexa.test';

// ---- minimal CBOR encoder (only the shapes a "none" attestation needs)
const head = (major: number, n: number): Buffer => {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
};
type Cbor = number | string | Buffer | Map<Cbor, Cbor>;
function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}
const b64u = (buf: Buffer) => buf.toString('base64url');
const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest();

class SoftwareAuthenticator {
  readonly credentialId = crypto.randomBytes(32);
  private readonly keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  counter = 0;

  private cose(): Buffer {
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    return cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  }
  private clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }
  private authData(flags: number, rpId: string, withCredential: boolean) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const base = Buffer.concat([sha256(rpId), Buffer.from([flags]), counter]);
    if (!withCredential) return base;
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([base, Buffer.alloc(16), idLength, this.credentialId, this.cose()]);
  }

  register(challenge: string, o: { origin?: string; rpId?: string } = {}) {
    const attestationObject = cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(0x45, o.rpId ?? RP_ID, true)]]));
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(this.clientData('webauthn.create', challenge, o.origin ?? ORIGIN)), attestationObject: b64u(attestationObject), transports: ['internal'] },
    };
  }

  assert(challenge: string, o: { origin?: string; rpId?: string; counter?: number } = {}) {
    this.counter = o.counter ?? this.counter + 1;
    const authData = this.authData(0x05, o.rpId ?? RP_ID, false);
    const clientDataJSON = this.clientData('webauthn.get', challenge, o.origin ?? ORIGIN);
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.keys.privateKey);
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) },
    };
  }
}

type Reply = { status: number; body: any };
type Call = (method: string, path: string, body?: unknown, token?: string) => Promise<Reply>;

async function withServer(run: (call: Call) => Promise<void>, configured = true): Promise<void> {
  if (configured) {
    process.env.WEBAUTHN_RP_ID = RP_ID;
    process.env.WEBAUTHN_ORIGINS = ORIGIN;
  } else {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_ORIGINS;
  }
  resetLockoutsForTests();
  resetPasskeysForTests();
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(PASSWORD));
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', enterpriseAuthRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const call: Call = async (method, path, body, token) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function makeUser(tag: string) {
  const email = `${tag}-${Math.random().toString(36).slice(2, 8)}@retail.local`;
  createEnhancedUser({
    id: `user-${email}`, companyId: findUserByEmail('admin@retail.local')!.companyId, email, name: tag,
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: hashPassword(PASSWORD), status: 'active',
  });
  return email;
}

const signIn = async (call: Call, email: string) => (await call('POST', '/login', { email, password: PASSWORD })).body.token as string;

async function enrol(call: Call, token: string, key: SoftwareAuthenticator, deviceName = 'Test key') {
  const begin = await call('POST', '/passkeys/register/options', {}, token);
  assert.equal(begin.status, 200, JSON.stringify(begin.body));
  return call('POST', '/passkeys/register/verify', { challengeToken: begin.body.challengeToken, response: key.register(begin.body.options.challenge), deviceName }, token);
}

async function passkeyLogin(call: Call, key: SoftwareAuthenticator, email?: string, tweak: Parameters<SoftwareAuthenticator['assert']>[1] = {}) {
  const begin = await call('POST', '/passkeys/login/options', email ? { email } : {});
  assert.equal(begin.status, 200, JSON.stringify(begin.body));
  const verify = await call('POST', '/passkeys/login/verify', { challengeToken: begin.body.challengeToken, response: key.assert(begin.body.options.challenge, tweak) });
  return { begin, verify };
}

test('passkeys are off (503) until the relying party is configured', async () => {
  await withServer(async (call) => {
    const token = await signIn(call, makeUser('pk-off'));
    assert.equal((await call('GET', '/passkeys', undefined, token)).body.configured, false);
    assert.equal((await call('POST', '/passkeys/register/options', {}, token)).status, 503);
    assert.equal((await call('POST', '/passkeys/login/options', {})).status, 503);
  }, false);
});

test('register a passkey, then sign in with it (no password, no TOTP) and use the session', async () => {
  await withServer(async (call) => {
    const email = makeUser('pk-ok');
    const token = await signIn(call, email);
    const key = new SoftwareAuthenticator();
    const registered = await enrol(call, token, key);
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const list = await call('GET', '/passkeys', undefined, token);
    assert.equal(list.body.passkeys.length, 1);
    assert.equal(list.body.passkeys[0].deviceName, 'Test key');
    assert.equal(list.body.passkeys[0].publicKey, undefined, 'key material is never listed');

    // discoverable (no email) and email-scoped sign-in both work
    const first = await passkeyLogin(call, key);
    assert.equal(first.verify.status, 200, JSON.stringify(first.verify.body));
    assert.equal(first.verify.body.user.email, email);
    assert.equal((await call('GET', '/passkeys', undefined, first.verify.body.token)).status, 200, 'the issued token is a working session');
    const second = await passkeyLogin(call, key, email);
    assert.equal(second.verify.status, 200);
    assert.ok((await call('GET', '/passkeys', undefined, token)).body.passkeys[0].lastUsedAt);
  });
});

test('a sign-in ceremony cannot be replayed, and a stale or cloned authenticator counter is refused', async () => {
  await withServer(async (call) => {
    const token = await signIn(call, makeUser('pk-replay'));
    const key = new SoftwareAuthenticator();
    assert.equal((await enrol(call, token, key)).status, 201);

    const begin = await call('POST', '/passkeys/login/options', {});
    const response = key.assert(begin.body.options.challenge);
    assert.equal((await call('POST', '/passkeys/login/verify', { challengeToken: begin.body.challengeToken, response })).status, 200);
    // the identical request again: the ceremony token was already used
    assert.equal((await call('POST', '/passkeys/login/verify', { challengeToken: begin.body.challengeToken, response })).status, 401);

    // a fresh ceremony, but the authenticator reports a counter that is not ahead of the stored one
    const stale = await passkeyLogin(call, key, undefined, { counter: 1 });
    assert.equal(stale.verify.status, 401);
    // and the genuine, ahead-of-stored counter still works afterwards
    assert.equal((await passkeyLogin(call, key, undefined, { counter: 5 })).verify.status, 200);
  });
});

test('wrong origin, wrong relying party and a foreign challenge are all refused', async () => {
  await withServer(async (call) => {
    const token = await signIn(call, makeUser('pk-bad'));
    const key = new SoftwareAuthenticator();
    assert.equal((await enrol(call, token, key)).status, 201);

    assert.equal((await passkeyLogin(call, key, undefined, { origin: 'https://evil.example' })).verify.status, 401);
    assert.equal((await passkeyLogin(call, key, undefined, { rpId: 'evil.example' })).verify.status, 401);

    const begin = await call('POST', '/passkeys/login/options', {});
    const other = await call('POST', '/passkeys/login/options', {});
    const wrongChallenge = await call('POST', '/passkeys/login/verify', { challengeToken: begin.body.challengeToken, response: key.assert(other.body.options.challenge) });
    assert.equal(wrongChallenge.status, 401);
    // a login token is not accepted as a registration token (and vice versa)
    const reg = await call('POST', '/passkeys/register/verify', { challengeToken: begin.body.challengeToken, response: new SoftwareAuthenticator().register(begin.body.options.challenge) }, token);
    assert.equal(reg.status, 400);
    // registration from the wrong origin never saves a key
    const regBegin = await call('POST', '/passkeys/register/options', {}, token);
    const badOrigin = await call('POST', '/passkeys/register/verify', { challengeToken: regBegin.body.challengeToken, response: new SoftwareAuthenticator().register(regBegin.body.options.challenge, { origin: 'https://evil.example' }) }, token);
    assert.equal(badOrigin.status, 400);
    assert.equal((await call('GET', '/passkeys', undefined, token)).body.passkeys.length, 1);
  });
});

test("one user cannot register with another user's registration ceremony, and the same key cannot be added twice", async () => {
  await withServer(async (call) => {
    const tokenA = await signIn(call, makeUser('pk-a'));
    const tokenB = await signIn(call, makeUser('pk-b'));
    const beginA = await call('POST', '/passkeys/register/options', {}, tokenA);
    const stolen = await call('POST', '/passkeys/register/verify', { challengeToken: beginA.body.challengeToken, response: new SoftwareAuthenticator().register(beginA.body.options.challenge) }, tokenB);
    assert.equal(stolen.status, 400);

    const key = new SoftwareAuthenticator();
    assert.equal((await enrol(call, tokenA, key)).status, 201);
    assert.equal((await enrol(call, tokenB, key)).status, 409, 'a credential id belongs to one account');
  });
});

test('removing a passkey stops it working; nobody can remove someone else\'s', async () => {
  await withServer(async (call) => {
    const tokenA = await signIn(call, makeUser('pk-del-a'));
    const tokenB = await signIn(call, makeUser('pk-del-b'));
    const key = new SoftwareAuthenticator();
    assert.equal((await enrol(call, tokenA, key)).status, 201);
    const id = (await call('GET', '/passkeys', undefined, tokenA)).body.passkeys[0].id as string;

    assert.equal((await call('DELETE', `/passkeys/${id}`, undefined, tokenB)).status, 404);
    assert.equal((await passkeyLogin(call, key)).verify.status, 200, 'still works after the failed foreign delete');
    assert.equal((await call('DELETE', `/passkeys/${id}`, undefined, tokenA)).status, 200);
    assert.equal((await passkeyLogin(call, key)).verify.status, 401);
  });
});

test('a deactivated user cannot sign in with a passkey, and an unknown email gets the same options shape', async () => {
  await withServer(async (call) => {
    const email = makeUser('pk-off-user');
    const token = await signIn(call, email);
    const key = new SoftwareAuthenticator();
    assert.equal((await enrol(call, token, key)).status, 201);
    findUserByEmail(email)!.status = 'inactive';
    assert.equal((await passkeyLogin(call, key)).verify.status, 401);

    const known = await call('POST', '/passkeys/login/options', { email: 'admin@retail.local' });
    const unknown = await call('POST', '/passkeys/login/options', { email: 'nobody-here@retail.local' });
    assert.deepEqual(Object.keys(known.body).sort(), Object.keys(unknown.body).sort());
    assert.deepEqual(Object.keys(known.body.options).sort(), Object.keys(unknown.body.options).sort());
  });
});
