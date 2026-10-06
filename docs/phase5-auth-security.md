# Phase 5: authentication and sign-in security

## What already existed (not rebuilt)

bcrypt passwords, short-lived access JWTs with rotating, hashed refresh
sessions and reuse detection (ADR-003), email OTP sign-in, a per-IP login
limiter, a global API limiter, `helmet` + HSTS, "sign out everywhere", and
per-company permission overrides. Audit export lives in `/reports/audit-export`.

## What this phase adds

1. **Optional TOTP two-factor sign-in** (RFC 6238).
   - `lib/totp.ts`: HMAC-SHA1 via `node:crypto`, checked against the RFC 6238
     test vectors; secrets encrypted at rest with AES-256-GCM (random IV per
     secret) under `TOTP_ENCRYPTION_KEY` (32 bytes, base64). No hand-rolled
     crypto (AGENTS.md rule 5).
   - `lib/two-factor-store.ts`: Postgres in database mode, memory otherwise.
     Each 30-second step is accepted once (replay protection; claimed with an
     atomic `updateMany`). 8 single-use backup codes, stored only as HMAC hashes.
   - Password **and** email-OTP sign-in both return
     `{ twoFactorRequired, challengeToken }` for an enrolled account. The
     challenge is a 5-minute JWT with `tokenType: 'twofactor'`, which
     `verifyJWT(…, 'access')` rejects, so it cannot be used as an access token.
   - Routes under `/api/v1/auth/2fa/`: `verify-login`, `status`, `setup`,
     `enable`, `disable`. Turning it off needs a current or backup code.
   - Without `TOTP_ENCRYPTION_KEY` the feature reports "not configured"
     (503 on setup) and sign-in is unchanged.
2. **Per-account lockout** (`lib/login-lockout.ts`, table `AuthLockout`): 5
   failures in 15 minutes lock the account key for 15 minutes (HTTP 429 with
   `Retry-After`). The existing limiter is per-IP, so a spread-out guessing
   run against one account was never slowed. Unknown emails count the same,
   so existence is not revealed. Second-factor attempts have their own key.
3. **Enumeration fix:** the password login used to check "account inactive"
   before the password, revealing an inactive account without credentials.
   It is now checked after the password is verified.
4. **Clients:** web login has a second step and an Account security panel on
   the Admin page; the Flutter login handles the challenge.

## Decisions and trade-offs

- Lockout can be used to lock a victim out for 15 minutes. Email-OTP sign-in
  uses a different key, so a locked user still has a way in.
- No QR image: setup shows the key and an `otpauth://` link, to avoid adding a
  QR library. Enrolment UI is on the Admin page (admin roles); the API works
  for every role.
- Passkeys/WebAuthn were not attempted: they need an origin-bound ceremony
  library and device testing this environment cannot do.

## Verification

Memory mode: `lib/totp.test.ts`, `login-lockout.test.ts`,
`two-factor-store.test.ts`, `routes/two-factor-auth.http.test.ts` (11 HTTP
cases). Postgres: `lib/two-factor-store.postgres.test.ts` (encryption at rest,
concurrent replay of a TOTP code and a backup code, cascade, persisted lockout).

## Results (local Postgres 17)

- Full real-Postgres run before this phase's schema change: 38 of 39 suites
  passed; the 39th (`persistence-opening-stock-expiry`) failed only because the
  local database was not seeded (CI runs `db:seed` first). After seeding it
  passes, so all 39 are green. `two-factor-store.postgres.test.ts` (5 tests)
  passes against the new migration, and `prisma migrate diff` shows no drift.
- Memory-mode API tests 730 passing, web 123 + 29 component tests, Flutter 92.
