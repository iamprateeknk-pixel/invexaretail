# Enterprise 2.0: P0 deployment tranche

Base revision: `main` at `d306080b43d867135de770774de751ffb6747d7b`.
Implementation branch: `codex/enterprise-2.0-p0`.

## Changes in this tranche

- The API image now includes `scripts/verify-production-db.cjs`, and CI builds the final image, runs migrations and database verification from it, then checks `/health`, `/ready` and `/meta`.
- The API is the only Railway migration owner. Worker startup checks that every migration shipped with its image is already applied.
- The duplicate `/items/version` OpenAPI operation was removed and the generated client refreshed.
- Contract coverage now walks mounted child routers, matching the actual Express route tree.
- API dependency fixes remove the unexcepted high/critical findings; the now-unused API audit exceptions were removed.
- Deployment configuration checks and worker schema guard tests were added.

## Local evidence

- `npm run build`: passed.
- `npm test`: 972 passed, 0 failed, 324 skipped. Database-backed cases were skipped because this machine has no Postgres service.
- `node --test scripts/deployment-config.test.cjs`: 2 passed.
- Contract validation, generated-client drift check and contract typecheck: passed.
- Architecture lint: 0 new violations; 6 existing findings are now tracked. The transfer queries use the shared company scope helper; the stock parity harness writes fixtures. The control-plane floating-point values remain release debt and are described below.
- API high/critical audit gate: passed with 0 exceptions.

## Release blockers still open

- Blueprint F01 remains open: `/sync/v1/mutations` still acknowledges stock adjustments through the separate `ControlPlaneLedger` path (`ControlPlaneSync`) rather than the canonical inventory posting service. This path stores quantities as floating-point values and has not been reconciled with the authoritative journal. Do not treat mobile offline stock posting as Enterprise-ready until it is migrated or safely retired with a tested replacement.
- Other blueprint P0 workflows, including independent approval and self-review protection, have not been revalidated in this tranche.
- The exact Docker image and real-Postgres workflow checks are pending the GitHub PR run. No production or staging environment was changed here.

This tranche is not an Enterprise 2.0 release approval. Production promotion remains gated on the open P0/P1 work, CI evidence, staging rehearsal and the blueprint's data-integrity and rollback acceptance checks.
