# Week 18: archive the legacy backend prototype

## Scope note

Unlike Weeks 12-17, this one *is* directly named in this repo's own text -
AGENTS.md's Repository layout section has said since before this session
began: "see Week 18 of the execution guide for the archive-after-parity-
check plan." The guide document itself still isn't recoverable, but the
plan's target and trigger condition (Week 18, archive `backend/`/`database/`
after confirming `api/` has parity) are knowable directly from this repo,
not guessed.

## What was already done

`database/` (the MySQL/Sequelize schema/migrations half of the pre-`api/`
prototype) was already removed by an earlier commit ("Migrate Invexa Retail
to PostgreSQL and complete Week 1 controls"), before this session reached
Week 18.

## The parity check

Read every file in `backend/src/` (558 lines: 9 route files, 3 middleware
files, `index.ts`). Findings:

- **Never actually wired to a database.** `sequelize` is a listed
  dependency and `package.json` references `src/migrations/run.ts`/
  `src/seeds/run.ts`, but neither those files nor any Sequelize model exist
  anywhere in the directory - every route holds its data in a plain
  in-memory array, reset on every restart. It was a scaffold, not a working
  alternate backend that ever needed a real migration.
- **Auth**: hardcoded demo users, one shared fixed password, a JWT signed
  with a fallback `'secret'` literal. `api/`'s `lib/otp-auth.ts` (bcrypt)
  and `lib/session-store.ts` (persisted, hashed, rotating refresh sessions
  - ADR-003) supersede it completely and more safely.
- **Items, Locations, Stock, Transfers, Counts, Picker tasks, Audit log,
  Device tokens**: each an in-memory CRUD stub with 2-3 hardcoded fixture
  rows. `api/` has a real, tested, Postgres-backed equivalent for every one
  (see `docs/archive/legacy-backend-prototype/README.md` for the exact
  file-by-file mapping).
- **Nothing else in the repository references it** - grepped `render.yaml`,
  `docker-compose.yml`, `package.json`, `.gitignore`, and `mobile/`'s
  source for `backend` and found nothing.

Full parity confirmed, exceeded on every axis (persistence, auth, tenant
scoping, tests) by `api/`.

## What changed

`backend/` moved (via `git mv`, history preserved) to
`docs/archive/legacy-backend-prototype/backend/`, with a `README.md`
recording the parity check above. AGENTS.md's Repository layout section
updated to reflect both `database/`'s earlier removal and this archive.

## Not done

Nothing else - this was a self-contained archive task, not a feature week.
`api/`, `web/`, `admin-panel/`, `mobile/` are unaffected.
