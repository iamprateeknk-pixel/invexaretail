import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import coreRouter from './core.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

// R13 — upload boundary security suite.
//
// The API's upload surface is one shared multer instance
// (routes/core-shared.ts: memory storage, 15 MB cap, NO fileFilter) behind
// two route families:
//   * item photos   POST /api/v1/items/:itemId/photos            (field "photo")
//   * import files  POST /api/v1/imports/opening-stock/preview   (field "file")
//                   + the sibling preview/commit endpoints in core-imports.ts
// Photo content is validated by magic bytes (lib/transfer-evidence.ts
// evidenceMime: PNG/JPEG/WebP only, <= 5 MB); import files are gated by a
// .xlsx/.xls/.csv extension allowlist before parsing (core-imports.ts
// readUploadedStockFile). Filenames are sanitised before they are stored
// as data — nothing is ever written to a filesystem path. These tests pin
// that boundary in-process, in the same style as
// events.http.test.ts (real routers, memory-mode seed, fetch).
//
// Mode note: photo PERSISTENCE requires a database (lib/item-photos.ts
// throws without one), so in this memory-mode harness a fully valid photo
// upload ends at 503 "Photo was not saved." — the security assertions are
// about what is REJECTED before storage (401/403/404/400), which behaves
// identically in both modes. The one place where the exact status is
// environment-shaped is the oversize case: there is no MulterError
// handler in src/index.ts (verified by read), so Express's default error
// handler answers — the test asserts rejection, and the first live run
// should pin the exact code (expected 500).

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const tinyPng = Buffer.concat([PNG_HEADER, Buffer.from('filler-bytes')]);
const exeBytes = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 7)]);
const textBytes = Buffer.from('this is not an image at all');

function userFor(email: string) {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return user;
}

function tokenFor(email: string): string {
  const user = userFor(email);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', coreRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function createItem(url: string, token: string): Promise<string> {
  const response = await fetch(`${url}/api/v1/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: `R13-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: 'Upload boundary probe' }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { item?: { id: string }; id?: string };
  const id = body.item?.id ?? body.id;
  assert.ok(id, 'created item carries an id');
  return id;
}

async function uploadPhoto(
  url: string,
  itemId: string,
  options: { token?: string; bytes?: Buffer; filename?: string; omitFile?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  if (!options.omitFile) {
    form.append('photo', new Blob([new Uint8Array(options.bytes ?? tinyPng)]), options.filename ?? 'photo.png');
  }
  const response = await fetch(`${url}/api/v1/items/${itemId}/photos`, {
    method: 'POST',
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

async function importPreview(
  url: string,
  options: { token?: string; bytes?: Buffer; filename?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(options.bytes ?? textBytes)]), options.filename ?? 'opening.csv');
  const response = await fetch(`${url}/api/v1/imports/opening-stock/preview`, {
    method: 'POST',
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

test('photo upload: unauthenticated is refused before anything else happens', async () => {
  await withServer(async (url) => {
    const itemId = await createItem(url, tokenFor('admin@retail.local'));
    const { status } = await uploadPhoto(url, itemId, {});
    assert.equal(status, 401);
  });
});

test('photo upload: a missing file is a clean 400', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    const itemId = await createItem(url, token);
    const { status, body } = await uploadPhoto(url, itemId, { token, omitFile: true });
    assert.equal(status, 400);
    assert.match(String(body.message ?? ''), /Photo file is required/);
  });
});

test('photo upload: content decides, not the filename — text and EXE bytes named as images are rejected', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    const itemId = await createItem(url, token);
    for (const [bytes, filename] of [
      [textBytes, 'photo.png'],
      [exeBytes, 'photo.jpg'],
      [exeBytes, 'photo.exe.png'], // double extension, executable content
    ] as Array<[Buffer, string]>) {
      const { status, body } = await uploadPhoto(url, itemId, { token, bytes, filename });
      assert.equal(status, 400, `${filename} must be rejected by content`);
      assert.match(String(body.message ?? ''), /Only JPEG, PNG and WebP/);
    }
  });
});

test('photo upload: a real PNG above the 5 MB evidence cap is rejected even though multer allows 15 MB', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    const itemId = await createItem(url, token);
    const sixMb = Buffer.concat([PNG_HEADER, Buffer.alloc(6 * 1024 * 1024, 3)]);
    const { status, body } = await uploadPhoto(url, itemId, { token, bytes: sixMb });
    assert.equal(status, 400);
    assert.match(String(body.message ?? ''), /between 1 byte and 5 MB/);
  });
});

test('photo upload: another tenant\'s item — or a missing one — is a 404, never a write', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    // callerOwnsItem makes foreign and missing items indistinguishable.
    const { status } = await uploadPhoto(url, 'no-such-item-id', { token });
    assert.equal(status, 404);
  });
});

test('photo upload: roles that may not upload get 403 (auditor), after ownership passes', async () => {
  await withServer(async (url) => {
    const admin = tokenFor('admin@retail.local');
    const itemId = await createItem(url, admin);
    const { status, body } = await uploadPhoto(url, itemId, { token: tokenFor('auditor@retail.local') });
    assert.equal(status, 403);
    assert.match(String(body.message ?? ''), /access denied/);
  });
});

test('photo upload: a valid PNG is accepted by validation (persistence then needs a database)', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    const itemId = await createItem(url, token);
    const { status, body } = await uploadPhoto(url, itemId, { token });
    // Memory mode: 503 "Photo was not saved" (no database). DB-backed: 201.
    assert.ok(status === 201 || status === 503, `unexpected status ${status}: ${JSON.stringify(body)}`);
    if (status === 503) assert.match(String(body.message ?? ''), /Photo was not saved/);
    if (status === 201) {
      const list = await fetch(`${url}/api/v1/items/${itemId}/photos`, { headers: { Authorization: `Bearer ${token}` } });
      const listed = (await list.json()) as { photos?: unknown[] };
      assert.equal((listed.photos ?? []).length, 1);
    }
  });
});

test('photo upload: a traversal filename is treated as data, never as a path', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    const itemId = await createItem(url, token);
    const { status, body } = await uploadPhoto(url, itemId, { token, filename: '../../../evil.png' });
    assert.ok(status === 201 || status === 503, `unexpected status ${status}`);
    // Uploads live in memory storage and are persisted as DB rows; the
    // stored name is sanitised (lib/item-photos.ts replaces / and \ with
    // _). If a photo record comes back, its name must carry no separator.
    const photo = body.photo as { fileName?: string } | undefined;
    if (photo?.fileName) {
      assert.ok(!photo.fileName.includes('/') && !photo.fileName.includes('\\'), `stored name must be separator-free, got ${photo.fileName}`);
    }
    // A scary name with honest PNG content passes content validation like
    // any other name: 'photo.png.exe' + PNG bytes behaves as a photo.
    const renamed = await uploadPhoto(url, itemId, { token, filename: 'photo.png.exe' });
    assert.ok(renamed.status === 201 || renamed.status === 503, `unexpected status ${renamed.status}`);
  });
});

test('import preview: the extension allowlist is enforced before parsing', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    // core-imports readUploadedStockFile: only .xlsx/.xls/.csv pass; the
    // check is on the final extension, so a double extension fails too.
    for (const filename of ['opening.json', 'opening.csv.exe', 'opening']) {
      const { status, body } = await importPreview(url, { token, bytes: textBytes, filename });
      assert.equal(status, 400, `${filename} must be refused by the allowlist`);
      assert.match(String(body.message ?? ''), /Only \.xlsx, \.xls and \.csv/);
    }
  });
});

test('import preview: unauthenticated is refused', async () => {
  await withServer(async (url) => {
    const { status } = await importPreview(url, {});
    assert.equal(status, 401);
  });
});

test('import preview: non-admin roles are refused before the file is read', async () => {
  await withServer(async (url) => {
    const { status, body } = await importPreview(url, { token: tokenFor('store@retail.local') });
    assert.equal(status, 403);
    assert.match(String(body.message ?? ''), /Only admins can preview imports/);
  });
});

test('import preview: an unreadable file is a clean 400, not a crash', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    const garbage = Buffer.from([0x00, 0xff, 0x10, 0x80, 0xfe, 0x01, 0x02, 0x03]);
    const { status, body } = await importPreview(url, { token, bytes: garbage, filename: 'opening.csv' });
    assert.equal(status, 400);
    assert.equal(typeof body.message, 'string');
  });
});

test('import preview: an oversize file is rejected and creates no batch', async () => {
  await withServer(async (url) => {
    const token = tokenFor('admin@retail.local');
    const sixteenMb = Buffer.alloc(16 * 1024 * 1024, 1); // shared multer cap is 15 MB
    const { status, body } = await importPreview(url, { token, bytes: sixteenMb, filename: 'huge.csv' });
    // No MulterError handler exists in src/index.ts (or in this harness):
    // Express's default error handler answers, expected 500 — the security
    // invariant asserted here is rejection + no staged batch.
    assert.ok(status >= 400, `oversize upload must be rejected, got ${status}`);
    assert.equal(body.batchToken, undefined);
  });
});
