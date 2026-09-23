# ADR-003: short-lived access tokens + persisted, hashed, rotating refresh session families

## Context
Auth issued two JWTs: a short(ish) access token and a **refresh token that
was also a JWT**, both hand-signed with a custom HMAC encoder in
`lib/otp-auth.ts` instead of the `jsonwebtoken` package already listed in
`package.json` - itself the "custom crypto" pattern this repo's own
AGENTS.md prohibits. The refresh token carried a 10-year expiry and was
tracked only in an in-process `Map<token, data>` (`enterprise-repository.ts`),
keyed by the *raw* token value: wiped on every restart, invisible to a
second Render replica, no rotation, no reuse detection, and revocation was
"delete one map entry" with no way to invalidate every session for a
compromised account. OTP codes were `Math.floor(100000 + Math.random() *
900000)` (not cryptographically random) stored in another in-process array,
compared with a plain `===`.

## Decision
1. **Access tokens**: short-lived (15 minutes, down from 60), signed with
   `jsonwebtoken` (`lib/otp-auth.ts`), never persisted.
2. **Refresh tokens**: opaque, high-entropy random strings (`crypto.randomBytes(32)`),
   never JWTs. Only a SHA-256 hash of the token is ever stored. Each token
   belongs to a **session family** (`UserSession.familyId`); refreshing
   rotates the family - the presented token is marked `ROTATED` and a new
   `ACTIVE` token is issued in the same family. Presenting a token that is
   already `ROTATED` or `REVOKED` is treated as replay/theft and revokes the
   **entire family** atomically (`lib/session-store.ts`, backed by the
   `UserSession` Prisma model - the same table an earlier, unused
   `UserSession` schema already reserved for this purpose).
3. **Concurrent rotation** (two requests presenting the same active token,
   e.g. two replicas or a retried request) is resolved by an atomic
   conditional `UPDATE ... WHERE status = 'ACTIVE'`: exactly one request wins
   the `ACTIVE -> ROTATED` transition; the loser is treated as reuse and the
   family is revoked. Validated against real Postgres with concurrent
   requests (`lib/session-store.postgres.test.ts`).
4. **Browser delivery**: the refresh token is set as a `Secure HttpOnly
   SameSite` cookie (`invexa_rt`, scoped to `/api/v1/auth`). `SameSite=None`
   in production (API and web app are different origins) requires `Secure`,
   so the cookie is never sent over plain HTTP. Refresh/logout also check
   the `Origin` header against the CORS allowlist as CSRF defense in depth
   beyond the cookie's `SameSite` attribute.
5. **Mobile delivery**: unchanged transport (refresh token in the JSON
   response body) - mobile has no cookie jar and must receive the value to
   put it in platform secure storage, which is Week 16's job, not this
   week's. This is the "temporary compatibility path... behind an explicit
   expiry flag" the guide asks for: `LEGACY_REFRESH_TOKEN_IN_BODY_UNTIL` (an
   ISO date) stops including the token in the JSON body for *browser*
   requests (any request carrying an `Origin` header) after that date;
   requests with no `Origin` header (native apps) always get it in the body.
6. **OTP**: `crypto.randomInt(0, 1_000_000)` (not `Math.random`), persisted
   only as an HMAC-SHA256 hash under a server-side pepper
   (`OTP_PEPPER`, falling back to `JWT_SECRET`), with a purpose, attempt
   count, max-attempts lockout, and a `consumedAt` timestamp set by a single
   atomic conditional update so the same code cannot be consumed twice even
   under a concurrent retry (`lib/session-store.ts`).
7. **Revoke-all**: `POST /api/v1/auth/logout-all` revokes every session
   family for the authenticated user, not just the caller's own session
   ("sign out everywhere" after a suspected compromise).

## Alternatives considered
- **Keep refresh tokens as long-lived JWTs, just persist a blocklist.**
  Rejected: a blocklist only helps if you remember to check it (and clean it
  up); a positive allowlist with rotation gives reuse detection for free,
  which a blocklist does not.
- **Redis-backed session store.** Deferred, not rejected: Postgres is
  already the durable store this app depends on for everything else; adding
  Redis for one table is disproportionate at current scale. Revisit if
  session volume or replica count makes a Postgres row-per-token approach a
  measured bottleneck.
- **Force web to stop receiving the refresh token in the body immediately.**
  Rejected for *this* PR: the web app currently persists `refreshToken` from
  the JSON response itself; flipping that off before the client is updated
  to rely on the cookie (`credentials: 'include'`) would break login for
  every web user today. `LEGACY_REFRESH_TOKEN_IN_BODY_UNTIL` makes the
  cutover an explicit, scheduled decision instead of an accidental outage.

## Migration impact
- `UserSession` (previously declared but never wired to any code) gained
  `familyId`, `tokenHash` (replacing `token`), `status`, `rotationCounter`,
  `replacedByTokenHash`, `expiresAt`; the old unused `token` unique
  constraint was dropped. New `OtpChallenge` model.
- Every previously-issued refresh token (a JWT) is invalid the moment this
  ships - no migration path preserves them, because they were never
  persisted anywhere a migration could read them from, and the whole point
  is that they should not be trusted as bearer-only credentials any more.
  **Every signed-in user is forced to log in again.** This is the "forced-
  login impact" the guide asks to call out explicitly in the PR.
- `lib/otp-auth.ts` no longer exports `generateRefreshToken`,
  `REFRESH_TOKEN_TTL_SECONDS`, or `generateOTP`; `lib/enterprise-repository.ts`
  no longer exports `storeRefreshToken`, `validateRefreshToken`,
  `isRefreshTokenRevoked`, `revokeRefreshToken`, `createOtpSession`,
  `verifyOtpSession`, `clearOtpSession`. Callers moved to
  `lib/session-store.ts`.

## Compatibility
`verifyJWT`'s access-token contract (`{ userId, companyId }` or `null`) is
unchanged, so `extractToken`/`requireAuth` and every route that calls them
did not need to change. `POST /api/v1/auth/refresh-token` and `/logout`
still accept `refreshToken` in the JSON body (mobile, and browsers until the
cookie-only cutover); they now also read the `invexa_rt` cookie first.

## Rollback
Revert this ADR's commit. The `UserSession`/`OtpChallenge` migration is
additive-shaped in isolation but this PR ships it alongside the code that
depends on the new columns, so rolling back means reverting the whole
change set together, then running `prisma migrate deploy` again against the
prior migration state (data loss for any sessions/OTP challenges issued in
between is expected and acceptable - they are short-lived by design).

## Consequences (measurable)
- Access token TTL: 3600s -> 900s.
- Refresh tokens: 0 persisted -> persisted, hashed, rotating, with reuse
  detection, validated end-to-end against real Postgres (login -> refresh ->
  replay-of-old-token correctly rejected with the entire family revoked ->
  a fresh login -> sign-out-everywhere correctly kills it), plus a
  concurrent-rotation race test.
- OTP: `Math.random()` -> `crypto.randomInt`; plaintext-in-memory ->
  HMAC-hashed-and-persisted; unlimited-ish attempts -> hard lockout after 5.
- "Custom crypto" surface in the auth path: the hand-rolled JWT
  encoder/decoder in `lib/otp-auth.ts` -> removed, replaced by
  `jsonwebtoken`.
