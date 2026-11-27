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
- Targeted control-plane HTTP and service regressions: 26 passed. Sync endpoints now require a locked company session, filter reads to that company, prevent cross-company idempotency-key reuse, and return `503 CANONICAL_INVENTORY_REQUIRED` for stock changes until canonical posting is wired.
- Branch manager stock-count workflow: 4 passed, including denial of self-review.
- GitHub CI at `c107cd5` built the final API runtime image, migrated and verified CI Postgres from that image, and passed architecture/contract checks, web/admin/mobile checks and security. The full real-Postgres matrix passed after correcting Prisma Decimal assertions, preserving PO receipt line/lot/expiry fields, and fixing company scope in the branch fixture. Dependency-free startup checks, the full API suite, helper tests and final-image `/health`, `/ready` and `/meta` smoke also passed.
- The first GitHub migration matrix run failed on existing schema drift between applied migrations and `schema.prisma`: old SQL migrations left defaults on tenant `companyId` and control-plane `updatedAt` fields. A forward-only migration now removes those 52 obsolete defaults without changing rows or rewriting history. GitHub Postgres verified a fresh database with all 50 migrations and no drift, plus a three-migration upgrade preserving all 25 seeded items and 25 ledger rows with no drift.
- The next CI step exposed an outdated seed upsert key after StockLedger became company-scoped. The seed now uses the company-qualified unique selector and supplies `companyId`; CI seed setup and initial Postgres integration coverage pass. The follow-on run passed all real-Postgres suites and the final-image startup smoke on `c107cd5`.
- Repository deployment files identify Cloudflare for web/control-plane UI and Railway for API/worker/Postgres. The stale Render wording in `README.md` and `AGENTS.md` is corrected. No provider dashboard was connected, so this evidence covers committed config and GitHub CI rather than current live deployment state.
- `mobile/` now has Flutter iOS and Windows runner scaffolds. Windows release built locally and its trusted browser handoff/USB scanner tests pass. Hosted CI at `c107cd5` passed Windows release and iOS simulator builds; the Android build workflow also passed. Apple device signing, store publication, Windows installer distribution and physical-device validation remain open.

## Release blockers still open

- `/sync/v1/mutations` returns `503 CANONICAL_INVENTORY_REQUIRED` for the platform sample stock adjustment. The control-plane session belongs to a platform operator. Any future operational stock sync must use a company user session, enforce the inventory approval policy and post through `InventoryPostingService`. The legacy `ControlPlaneLedger` simulation remains isolated for its unit-level scenarios.
- For blueprint F01, published text, number, date and boolean item fields now appear in Item Stock Detail. The API reads the durable published configuration, checks both visibility and editing rights, validates values and records the applied configuration version in the audit. A later revision can hide a field or change its label while retaining the item's stored value. List fields, other operational forms and validation during item creation remain open.
- Published Studio stock columns and action restrictions do reach `/api/v1/runtime/config`, with company and role isolation covered by a passing HTTP test. Broader workflow, approval and mobile-policy runtime activation still needs end-to-end verification.
- The sync surface previously allowed anonymous access and unscoped reads. It now requires a locked company session, scopes reads and device operations to that company, and binds new mutation/device ownership to the authenticated actor. Broader role and device lifecycle review remains open.
- The branch-manager stock-count flow denies self-review, as verified by its targeted HTTP suite. Broader approval-policy coverage from the blueprint remains open.
- The full real-Postgres suites and readiness/image startup smoke passed on `c107cd5`. They must rerun on the latest pushed head after the mobile navigation changes. No production or staging environment was changed here.
- iOS simulator and Windows release builds need a green CI run. Apple signing, app store submission, physical-device checks and Windows installer/release packaging remain open.

This tranche is not an Enterprise 2.0 release approval. Production promotion remains gated on the open P0/P1 work, CI evidence, staging rehearsal and the blueprint's data-integrity and rollback acceptance checks.

## Studio automation task rollout

1. Keep `ENABLE_STUDIO_AUTOMATION_TASKS=false` on the worker while applying the additive migration and starting the task-compatible API and worker images. Save these images as the rollback target before enabling creation.
2. In isolated staging, set the flag to `true` on the worker. Publish a test company's task automation and verify delivery, claiming, and completion. Record the two image identifiers and the task/run IDs.
3. Set the flag to `false` on the worker and restart the task-compatible images. Verify a pending task run keeps its attempts and status, existing inbox tasks can still be completed, and notification runs still deliver. Verify the rollback using the saved task-compatible images.
4. Keep the flag off after the drill until the release is approved. Review pending task runs before activating so the company can account for work queued during the pause.

The previous Prisma client from `8876612` was tested against a local PostgreSQL fixture containing a Studio task. It could not read exception rows with the new enum value. After the first task exists, use a task-compatible image for rollback and preserve all task rows.
