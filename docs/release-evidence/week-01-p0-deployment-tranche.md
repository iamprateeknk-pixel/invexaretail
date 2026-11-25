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
- Targeted control-plane HTTP regression: 7 passed. Stock adjustment now returns `503 CANONICAL_INVENTORY_REQUIRED` and leaves the separate control-plane ledger unchanged until canonical posting is wired.
- Branch manager stock-count workflow: 4 passed, including denial of self-review.
- GitHub CI built the final API runtime image, migrated and verified CI Postgres from that image, passed image startup smoke, architecture/contract checks, web/admin/mobile checks and all security jobs.
- The GitHub migration matrix failed on existing schema drift between applied migrations and `schema.prisma`: migration-created defaults differ across tenant `companyId` and control-plane `updatedAt` fields. The matrix stopped before the later real-Postgres integration suites. This must be reconciled with a reviewed forward migration/schema change; migration history was not rewritten.

## Release blockers still open

- Blueprint F01 remains open: `/sync/v1/mutations` no longer falsely acknowledges stock adjustment mutations, but returns `503 CANONICAL_INVENTORY_REQUIRED` until it can post through `InventoryPostingService`. Mobile offline stock posting is unavailable until that canonical integration has a tested replacement. The legacy `ControlPlaneLedger` simulation remains isolated for its unit-level scenarios.
- The branch-manager stock-count flow denies self-review, as verified by its targeted HTTP suite. Broader approval-policy coverage from the blueprint remains open.
- The migration matrix has exposed schema drift and prevented the remaining Postgres integration suites from running in CI. No production or staging environment was changed here.

This tranche is not an Enterprise 2.0 release approval. Production promotion remains gated on the open P0/P1 work, CI evidence, staging rehearsal and the blueprint's data-integrity and rollback acceptance checks.
