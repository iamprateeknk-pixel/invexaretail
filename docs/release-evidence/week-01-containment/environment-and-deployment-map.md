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

**Decision status: blocked pending platform confirmation and provisioning.** Prateek Choudhary is the staging decision owner. The repository currently describes multiple deployment paths (local Docker Compose, Hostinger shared hosting, Render, and Vercel web configuration), while GitHub has no configured Environment or deployment history that identifies a live staging target.

**Recommended candidate: a dedicated Render staging blueprint in Oregon.** This is a recommendation, not an approved deployment. `render.yaml` already models the API and worker processes and supplies an explicit region, whereas Hostinger documentation describes the production path and Vercel configuration covers the web artifact without the database and worker topology. The existing Render service names, `NODE_ENV=production`, and production CORS origins must not be reused as-is for staging. A staging blueprint must use separate service names, a separate database, staging-only origins and credentials, and a protected GitHub `staging` Environment before any restore rehearsal.

Production remains unchanged. No staging service or database was created during discovery.

When confirmed, record:

| Field | Required value |
| --- | --- |
| Staging owner | Prateek Choudhary (`iamprateeknk-pixel`); GitHub issue [#17](https://github.com/iamprateeknk-pixel/invexaretail/issues/17) |
| Host/runtime | Pending approval; recommended dedicated Render staging services in Oregon |
| Artifact source | Pending; reviewed commit/tag only, never an unreviewed working tree |
| Database | Isolated staging database identifier, no credentials |
| Queue/worker | Pending; separate staging worker required if Render is approved |
| Public endpoint | Pending; must not use production domains |
| Deploy command/runbook | Pending platform approval and staging-only configuration |
| Rollback artifact | Prior signed/tagged release |

## Owner decision required

Approve one of these before the real restore rehearsal:

1. Provision a dedicated Render staging API, worker and isolated database using staging-only configuration.
2. Provide an existing isolated Hostinger staging application and database that are demonstrably separate from production.
3. Name another controlled platform and provide its non-secret identifiers and access path.
