# Invexa Retail development setup

## Requirements

- Node.js 22.12 or newer
- Docker Desktop with the Linux container engine
- Flutter stable for the mobile application

## Start the database

```bash
docker compose up -d postgres
docker compose ps postgres
```

The local connection URL is:

```text
postgresql://retail:retail_password@127.0.0.1:5432/retail_inventory
```

## Prepare and run the API

```bash
cd api
npm ci
npm run db:migrate
npm run db:seed
npm run build
npm test
npm start
```

Set `DATABASE_URL`, `JWT_SECRET` and `SEED_PASSWORD` in your local environment. Do not commit real secrets. The API can run in seed-only memory mode when `DATABASE_URL` is intentionally unset, but release verification must use PostgreSQL.

Verify `http://127.0.0.1:4000/health` and `http://127.0.0.1:4000/ready`.

## Web and admin

```bash
cd web
npm ci
npm test
npm run lint
npm run build
```

```bash
cd admin-panel
npm install
npm test
npm run build
```

## Database checks

```bash
cd api
npm run db:validate
npm run db:migrate
npm run db:verify
npx tsx --test src/lib/postgresql.integration.test.ts
```

Use `pg_dump` and `pg_restore` for backups. Restore into a disposable database and compare table counts, key row counts and API readiness before approving a release. See `docs/POSTGRESQL_MIGRATION.md`.
