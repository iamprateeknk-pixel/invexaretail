# PostgreSQL migration and operations

PostgreSQL 17 is the only active database for the Invexa Retail API. Prisma migrations own the schema; application startup never creates or alters tables.

## Local development

1. Start PostgreSQL with `docker compose up -d postgres`.
2. Set `DATABASE_URL=postgresql://retail:retail_password@127.0.0.1:5432/retail_inventory`.
3. Run `npm run db:migrate` from `api/`.
4. Run `npm run db:seed` when demo data is required.
5. Run `npm run db:verify` and the PostgreSQL integration test before shipping.

## Production

Production runs PostgreSQL behind the root `docker-compose.yml` on the team's cloud host; `DATABASE_URL` is injected into both the API and worker. Each release applies migrations with `prisma migrate deploy` before the new containers start (`docs/PRODUCTION_RUNBOOK.md`, section 3).

Required operator-provided secrets: `SEED_PASSWORD` and `JWT_SECRET`. Never commit database URLs or copied production credentials.

## Migrating existing production data

The PostgreSQL baseline creates a new schema; it does not transform a legacy database dump. Export the existing business data from the approved source, transform and load it into an isolated PostgreSQL staging database, then compare every table count and business invariant before cutover. Keep the source read-only during the final delta/cutover window and retain its backup until owner sign-off.

Minimum acceptance checks:

- Prisma migration status is current.
- All expected tables exist.
- Exact source/target row counts are recorded.
- Tenant, item, lot, ledger and user relationships pass integrity checks.
- API health, readiness, authentication and read-only inventory flows pass.
- Backup restoration completes inside the approved RTO and the observed backup interval satisfies RPO.
- Rollback keeps the source database available until PostgreSQL sign-off.

The previous migration history is retained only for recovery/audit under `docs/archive/mysql-prisma-history/`; it is outside the active Prisma migration path and is never deployed.
