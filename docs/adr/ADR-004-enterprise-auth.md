# ADR-004: Auth stays JWT + RBAC/permission-table hybrid

## Context
Auth is stateless JWT (`lib/otp-auth.ts`: `generateJWT`, `hashPassword` via
bcrypt) carrying `userId` and `companyId`, verified per-request by
`extractToken` (`routes/enterprise-auth.ts`) and authorized by a role
(`Role` enum: `ADMIN`, `ADMIN_USER`, `BRANCH_MANAGER`, `STORE_USER`,
`WAREHOUSE_PICKER`, `AUDITOR`) plus a fine-grained `Permission` /
`RolePermission` / `UserPermission` table set for per-module
view/create/edit/delete/approve/export/archive/reverse grants. Session
bookkeeping (`UserSession`, `LoginHistory`) is DB-backed for audit and
revocation, separate from the stateless JWT itself - so a "revoked" session
still needs the JWT to expire or a revocation check on each request.

## Decision
Keep the hybrid: stateless JWT for cheap per-request verification, DB-backed
role + permission tables for authorization decisions, DB-backed
`UserSession`/`LoginHistory` for audit and manual revocation. Do not move to
fully stateless claims-based permissions (JWT carrying the permission list) -
permissions must be revocable within a session's lifetime without waiting for
token expiry, which a self-contained JWT cannot do.

## Alternatives considered
- **Fully stateless JWT (permissions baked into the token).** Rejected:
  makes revoking a permission mid-session impossible without a blocklist,
  which reintroduces the DB lookup this approach was meant to avoid, minus
  the audit trail.
- **Server-side sessions only (no JWT).** Rejected: the mobile app and SSE
  event stream (`routes/events.ts`) both depend on a bearer token they can
  attach to reconnects without a cookie jar.

## Migration impact
None from the Postgres switch - `User`, `UserSession`, `LoginHistory`,
`Permission`, `RolePermission`, `UserPermission` are unchanged Prisma models,
carried into the Postgres baseline migration as-is.

## Compatibility
No API change.

## Rollback
N/A - no code changes shipped with this ADR.

## Consequences (measurable)
- `custom-crypto` stays a prohibited pattern in `AGENTS.md`: password hashing
  is bcrypt only (`lib/otp-auth.ts`), no hand-rolled hashing/encryption for
  credentials anywhere in the auth path. `scripts/architecture-lint.mjs`
  flags any new `createCipher`/XOR-style crypto.
- Revisit this ADR if session-scoped permission checks become a proven
  latency problem (candidate mitigation: short-TTL in-process permission
  cache keyed by `userId`, not a token-embedded claim).
