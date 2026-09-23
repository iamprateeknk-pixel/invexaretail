# Archived: pre-`api/` backend prototype

Archived Week 18, per AGENTS.md's own note ("see Week 18 of the execution
guide for the archive-after-parity-check plan"). `database/` (the
MySQL/Sequelize schema/migrations half of this pre-`api/` prototype) was
already removed by an earlier commit
(`2129302` "Migrate Invexa Retail to PostgreSQL and complete Week 1
controls"); this completes the other half named alongside it.

## Parity check

Read every file in `backend/src/` (558 lines total across 9 route files, 3
middleware files, and `index.ts`) before archiving. Findings:

- **Not actually wired to a database.** `package.json` lists `sequelize` as
  a dependency and references `src/migrations/run.ts`/`src/seeds/run.ts`,
  but neither of those files (nor any Sequelize model) exists in the
  directory - every route holds its data in a plain in-memory array
  (`const items: any[] = []`, `const transfers: any[] = []`, etc.),
  reset on every restart. This was a scaffold, not a working alternate
  backend.
- **Auth**: hardcoded demo users, a fixed shared password
  (`'TestPassword123!'`), JWT signed with a fallback `'secret'` literal if
  `JWT_SECRET` is unset. `api/`'s `lib/otp-auth.ts` (bcrypt, real per-user
  hashes) and `lib/session-store.ts` (persisted, hashed, rotating refresh
  sessions - ADR-003) supersede this completely, safely.
- **Items, Locations, Stock, Transfers, Counts, Picker tasks, Audit log,
  Device tokens**: each was an in-memory CRUD stub with 2-3 hardcoded
  fixture rows. `api/` has a real, tested, Postgres-backed equivalent for
  every one of these (`routes/items.ts` + `lib/repositories/item-
  repository.ts`; `routes/branches.ts`; `lib/inventory-posting-service.ts`
  + `lib/stock-detail-service.ts`; `routes/transfers.ts` +
  `lib/transfer-command-service.ts`; `lib/domain-policies.ts`'s
  `StockCount` handling; `routes/operations-extension.ts`'s picker/pick-
  wave routes; `lib/audit.ts`'s `AuditLog`; `routes/control-plane.ts`'s
  `/devices/register`).
- **Nothing else in the repository references it.** Not `render.yaml`, not
  `docker-compose.yml`, not `mobile/`, not `admin-panel/` - grepped for
  `backend` across configs and the mobile app source and found nothing.

Full parity confirmed, and exceeded on every axis (real persistence, real
auth, real tenant scoping, real tests) by `api/`. Archived rather than
deleted, in case any historical detail here is ever worth referencing.
