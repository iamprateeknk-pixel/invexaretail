# Phase 7: security hardening and workflow

Audit method: `npm audit` on every package, then targeted searches of the API
for default secrets, unsafe raw SQL, non-constant-time comparisons, secrets in
query strings and dead auth code.

## Fixed

1. **Tenant onboarding created an admin with a public password.**
   `POST /saas/onboard` fell back to `ChangeMe123!` (public in this repository)
   when no password was sent, and the web form pre-filled that value. Anyone who
   knew the new admin's email could sign in. The route now requires a password
   that passes the strength rules and rejects the known default; the web field
   starts empty.
2. **Production could start with a public secret.** Several modules fall back to
   a constant when `JWT_SECRET` is unset (fine locally). `lib/production-guard.ts`
   now stops the server at startup, in production only, when `JWT_SECRET` is
   missing, a known placeholder or under 16 characters, when `OTP_PEPPER` is a
   placeholder, or when `SEED_PASSWORD` is the default. 16 to 31 characters is a
   warning, not a failure, so an existing deployment with a shorter-than-ideal
   but real secret still boots. All problems are listed in one error.
3. **Dead code with a weak secret removed.** `lib/auth.ts` and
   `middleware/auth.ts` (a second, unused JWT implementation falling back to
   `dev-secret-change-me`) were imported by nothing.
4. **Dependencies.** `web`: `npm audit fix` cleared the `source-map-js` finding
   (0 vulnerabilities after, build and tests pass). `admin-panel`: 0 after.

5. **`docker-compose.yml`** shipped `JWT_SECRET: change-this-in-production` and the
   default seed password for an image that runs with `NODE_ENV=production`. It now
   requires both to be exported (`${VAR:?message}`), otherwise compose stops with
   a clear message. Anyone running the full compose stack must set them first.

## Reviewed and left alone

- `api`: 4 high findings, all through the `prisma` CLI package
  (`mysql2` protocol issues, `deepmerge-ts`). The app uses PostgreSQL only, never
  speaks the MySQL protocol, and does not run the CLI on untrusted input, so they
  are not reachable. The suggested fix downgrades Prisma 7 to 6 (breaking); not
  applied. Re-check when Prisma releases a patched dependency set.
- Signature and secret comparisons already use `timingSafeEqual`; no secrets are
  read from query strings; the Android manifest has `allowBackup="false"` and
  `usesCleartextTraffic="false"`; raw SQL is limited to `lib/db.ts` helpers that
  translate placeholders and the schema-version read.

## Workflow

`node scripts/verify.mjs` runs the CI checks locally in fail-fast order
(`--quick` for typecheck and lint, `--mobile` to add Flutter). Real-Postgres
suites stay separate because they need a database.

## Not done

- Secret fallbacks remain in code for development; the guard makes production
  safe but a central secrets module would be cleaner.
- No automated check that `render.yaml` / Railway env names match what the guard
  needs; confirm `JWT_SECRET` is set on every deployed service.
