# Environment and deployment map

This is a discovery record derived from repository configuration and documentation. It deliberately omits secret values and must be confirmed against the hosting accounts before it is relied on operationally.

| Area | Discovered path | Evidence in repository | Status |
| --- | --- | --- | --- |
| Local development | Docker Compose: MySQL, API, web | `docker-compose.yml` | Present; uses development-only placeholders |
| API runtime | Node/Express API in `api/` with root `app.js` entry point | root `package.json`, `api/package.json`, CI startup smoke | Present |
| Web runtime | Vite build served as a web artifact | `web/package.json`, workflow | Present |
| Mobile runtime | Flutter Android client | `mobile/pubspec.yaml`, Android workflow | Present; current CI generates Android project |
| Hosted API references | Hostinger shared Node/MySQL and Render references | `docs/PRODUCTION_RUNBOOK.md`, `render.yaml`, source comments | Conflicting paths require owner confirmation |
| GitHub deployment control | Repository Environments, deployments, Actions secrets and Actions variables | GitHub API/CLI inventory on 22 September 2026 | No environments, deployments, secret names or variables were configured |
| Database | MySQL/MariaDB via Prisma | `api/prisma/`, `docker-compose.yml`, CI | Present |
| Queues/outbox | Application-managed worker/outbox references | `api/src/worker.ts`, source modules | Inventory and recovery still required |
| Domains and external services | API base, CORS, SMTP, object storage, Sentry, Stripe configuration keys | `api/.env.example` | Values intentionally not recorded |

## Local recovery tooling check

On 22 September 2026, the Docker client was present but the Docker Desktop Linux engine was not running. A local isolated MySQL backup/restore rehearsal therefore could not start. No container, database, or external environment was changed.

Docker Desktop initially crashed while initializing the optional inference manager because a stale `dockerInference` runtime reparse point could not be accessed or removed by Windows. The optional Model Runner was disabled through Docker's supported CLI, Docker recovered, and engine 29.8.0 completed the isolated rehearsal. No Docker volume, WSL distribution, production resource, or project data was removed.

## Canonical staging decision

**Decision status: Render approved as the canonical staging platform, with PostgreSQL required; provisioning is blocked until the application migration is complete.** Prateek Choudhary approved Render on 22 September 2026, then directed that MySQL be removed in favor of PostgreSQL. The repository currently uses Prisma/MySQL and MySQL-specific runtime SQL, so a staging database must not be provisioned until a separate reviewed migration converts the schema, queries, tests, recovery tooling and deployment configuration.

**Approved target design: a dedicated Render web, API, worker and managed PostgreSQL staging topology.** Service names, credentials, data and URLs must remain separate from production. Automatic deploys remain disabled for the recovery proof so the owner chooses the reviewed artifact deliberately. The final Blueprint and cost must be reviewed after the PostgreSQL migration passes fresh, upgrade, restore and rollback tests.

Production remains unchanged. No staging service or database was created during discovery.

When confirmed, record:

| Field | Required value |
| --- | --- |
| Staging owner | Prateek Choudhary (`iamprateeknk-pixel`); GitHub issue [#17](https://github.com/iamprateeknk-pixel/invexaretail/issues/17) |
| Host/runtime | Approved: dedicated Render staging services in Oregon; provisioning pending PostgreSQL migration |
| Artifact source | Reviewed PostgreSQL migration commit/tag only |
| Database | Dedicated Render PostgreSQL staging database; identifier pending migration and provisioning |
| Queue/worker | Separate staging worker; schedulers disabled for the recovery proof |
| Public endpoint | Render-assigned staging URLs after provisioning; production domains are not used |
| Deploy command/runbook | Pending PostgreSQL-compatible Blueprint; manual deploy only |
| Rollback artifact | Prior signed/tagged release |

## Owner decision required

Complete the PostgreSQL migration in a separate PR. Then confirm the Render dashboard's paid monthly total immediately before resource creation. After provisioning, record the generated non-secret service identifiers and URLs, then execute the isolated restore and smoke-check runbook.
