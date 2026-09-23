# Local PostgreSQL verification — 23 September 2026

Target: isolated Docker PostgreSQL 17 database on the developer workstation.

Results:

- Prisma schema validation: passed.
- PostgreSQL baseline migration `20260923000000_postgresql_baseline`: applied successfully.
- Production database verifier: passed.
- PostgreSQL rollback, advisory-lock and idempotency integration test: 1 passed, 0 failed.
- Seed: passed; 5 demo users and 3 items loaded.
- API database-mode smoke: `/health` passed and `/ready` reported repository state `ready` with 5 users.
- Disposable custom-format backup and restore: passed in 7.267 seconds.
- Restore comparison: 89 public tables, 5 users and 3 items matched exactly.
- Temporary restore database and dump: removed after verification.

This is local evidence, not a substitute for the required isolated Render staging restore and owner review.
