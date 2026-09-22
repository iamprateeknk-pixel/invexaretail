#!/usr/bin/env node
// Login diagnostics. Run on the server from the api/ directory:
//   node scripts/diagnose.cjs
// Each step prints OK or the reason it failed, so the first FAIL is the cause.
require('dotenv/config');

const PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe123!';
const EMAIL = process.env.DIAGNOSE_EMAIL || 'admin@retail.local';
const PORT = process.env.PORT || 4000;

const ok = (m) => console.log(`  OK    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures++; };
let failures = 0;

function step(n, title) {
  console.log(`\n${n}. ${title}`);
}

(async () => {
  console.log('InvexaRetail login diagnostics');
  console.log('='.repeat(60));

  // ---------------------------------------------------------------
  step(1, 'Environment');
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail('DATABASE_URL is not set. The API cannot load any user without it.');
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    fail('DATABASE_URL has no scheme. It must look like postgresql://user:pass@host:5432/dbname');
  } else {
    const safe = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
    ok(`DATABASE_URL = ${safe}`);
    if (/@[^/]*:\d+\/([^?]+)/.test(url)) {
      ok(`database name = ${url.match(/@[^/]*:\d+\/([^?]+)/)[1]}`);
    }
    if (url.includes('@') && /:[^@/]*@/.test(url)) {
      const pw = url.match(/:\/\/[^:]+:([^@]*)@/);
      if (pw && /[@#?/]/.test(decodeURIComponent(pw[1])) && pw[1] === decodeURIComponent(pw[1])) {
        fail('The password contains a special character that is not URL-encoded. "@" must be written as %40.');
      }
    }
  }
  console.log(`  info  persistence = ${url ? 'database' : 'memory (DATABASE_URL unset; API uses seed data)'}`);
  console.log(`  info  JWT_SECRET = ${process.env.JWT_SECRET ? 'set' : '(unset, falling back to the dev default)'}`);

  // ---------------------------------------------------------------
  step(2, 'Deployed build');
  const fs = require('fs');
  const path = require('path');
  const dist = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.js'))) {
    fail('dist/index.js is missing. Run: npm run build');
  } else {
    const core = path.join(dist, 'routes', 'core.js');
    if (!fs.existsSync(core)) {
      fail('dist/routes/core.js is missing, so this build predates the restored inventory API. Run: git pull && npm run build');
    } else {
      ok('dist/routes/core.js present (inventory routes are built)');
    }
    const otp = fs.readFileSync(path.join(dist, 'lib', 'otp-auth.js'), 'utf8');
    if (otp.includes('bcrypt')) {
      ok('dist/lib/otp-auth.js uses bcrypt (password fix is built)');
    } else {
      fail('dist/lib/otp-auth.js still hashes with sha256. This build is older than the login fix. Run: git pull && npm run build');
    }
  }

  // ---------------------------------------------------------------
  step(3, 'Database contents');
  let dbUsers = [];
  if (!url) {
    fail('skipped, DATABASE_URL is not set');
  } else {
    try {
      const { PrismaClient } = require('@prisma/client');
      const { PrismaPg } = require('@prisma/adapter-pg');
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      await prisma.$queryRaw`SELECT 1`;
      ok('connected');

      // The repo also ships database/schema.sql and backend/src/database/schema.sql,
      // which build a lowercase `users` table under a different design. Prisma
      // queries the exact-case "User" table, so importing the wrong one gives a
      // bare 401.
      const expected = ['User', 'Location', 'Item', 'Lot', 'StockLedger', 'StockCount', 'CountAssignment', 'Transfer', 'TransferLine', 'AuditLog'];
      const rows = await prisma.$queryRaw`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema()`;
      const present = rows.map((r) => r.t ?? r.TABLE_NAME);
      const missing = expected.filter((t) => !present.includes(t));
      if (missing.length === 0) {
        ok(`all ${expected.length} expected tables present`);
      } else {
        fail(`missing table(s): ${missing.join(', ')}`);
        console.log(`        database actually contains: ${present.join(', ') || '(nothing)'}`);
        const wrongSchema = present.some((t) => ['users', 'companies', 'branches', 'stock_lots', 'blind_counts'].includes(t));
        if (wrongSchema) {
          console.log('        This is database/schema.sql or backend/src/database/schema.sql.');
          console.log('        Those belong to a different design and this API cannot read them.');
        }
        console.log('        Fix: import invexaretail-database.sql, or run npm run db:migrate && npm run db:seed');
      }

      dbUsers = await prisma.user.findMany().catch(() => []);
      if (dbUsers.length === 0) {
        fail('the User table is empty. Import the SQL file, or run: npm run db:seed');
      } else {
        ok(`${dbUsers.length} user(s): ${dbUsers.map((u) => u.email).join(', ')}`);
      }
      await prisma.$disconnect();
    } catch (error) {
      fail(`cannot query the database: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------
  step(4, `Stored password for ${EMAIL}`);
  const target = dbUsers.find((u) => u.email === EMAIL);
  if (!target) {
    if (dbUsers.length) fail(`no user with that email. Present: ${dbUsers.map((u) => u.email).join(', ')}`);
    else fail('skipped, no users loaded');
  } else {
    ok(`role = ${target.role}`);
    const hash = target.passwordHash || '';
    if (hash.startsWith('$2')) {
      ok(`hash is bcrypt (${hash.slice(0, 7)}...)`);
      const bcrypt = require('bcryptjs');
      if (bcrypt.compareSync(PASSWORD, hash)) {
        ok(`"${PASSWORD}" matches the stored hash`);
      } else {
        fail(`"${PASSWORD}" does NOT match the stored hash. The account has a different password; re-run npm run db:seed or import the SQL file.`);
      }
    } else if (/^[a-f0-9]{64}$/.test(hash)) {
      fail('hash is sha256, written by an older build. Re-seed so it is stored as bcrypt.');
    } else {
      fail(`hash is in an unrecognised format (${hash.slice(0, 12)}...)`);
    }
  }

  // ---------------------------------------------------------------
  step(5, `Running API on port ${PORT}`);
  const base = `http://127.0.0.1:${PORT}`;
  let reachable = false;
  try {
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    ok(`/health -> ${health.status}`);
    reachable = true;
  } catch (error) {
    fail(`nothing is listening on ${base} (${error.message}). Start it with: npm start, or pm2 restart api`);
  }

  if (reachable) {
    try {
      const ready = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(5000) });
      const body = await ready.json().catch(() => ({}));
      if (ready.ok) ok(`/ready -> ${ready.status} ${JSON.stringify(body)}`);
      else fail(`/ready -> ${ready.status} ${JSON.stringify(body)}  (the API cannot reach the database)`);
    } catch (error) {
      fail(`/ready failed: ${error.message}`);
    }

    step(6, 'Login against the running API');
    try {
      const res = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        ok(`login -> 200, role = ${body.user?.role}`);
        const h = { Authorization: `Bearer ${body.token}` };
        for (const p of ['/api/v1/locations', '/api/v1/items', '/api/v1/dashboard']) {
          const r = await fetch(base + p, { headers: h, signal: AbortSignal.timeout(5000) });
          if (r.ok) ok(`${p} -> ${r.status}`);
          else fail(`${p} -> ${r.status}. The running process predates the restored routes; restart it.`);
        }
      } else if (res.status === 429) {
        fail('login -> 429, rate limited. Wait 15 minutes, or restart the API to clear the counter, then re-run.');
      } else if (res.status === 401) {
        fail('login -> 401. The running process still has no matching user in memory. If steps 3 and 4 passed, it is serving an old build or was not restarted: npm run build && pm2 restart api');
      } else {
        fail(`login -> ${res.status} ${JSON.stringify(body)}`);
      }
    } catch (error) {
      fail(`login request failed: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(failures === 0
    ? 'No problems found. If the browser still fails, it is serving a cached\nbundle or service worker: unregister it in DevTools and hard reload.'
    : `${failures} problem(s) found. Fix the first FAIL above and run this again.`);
  process.exit(failures === 0 ? 0 : 1);
})();
