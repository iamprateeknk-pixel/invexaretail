## Week and problem

- Week:
- Problem being solved:
- Business invariant protected:

## Scope

- Files changed:
- Explicitly out of scope:
- User-visible change:

## Architecture and contracts

- ADR impact:
- API contract change (or `None`):
- Migration/schema change (or `None`):
- Tenant and permission review:

## Risk and data migration

- Failure modes considered (tenant, stock, retry, offline, migration):
- Data migration: forward path, backfill, verification, recovery or roll-forward (or `None`):
- Stop conditions checked (new cross-tenant path, second stock write path, second offline queue, runtime DDL, secrets in client storage, reconciliation drift): none hit / explain

## Correctness and operations

- Idempotency and concurrency behavior:
- Audit/outbox impact:
- Observability, errors, and dashboards:
- Security review (auth, secrets, uploads, dependencies):

## Verification

- Unit/integration tests:
- Browser/mobile evidence:
- Migration rehearsal evidence:
- Performance observation:
- Acceptance evidence (exact command, run or artifact proving the exit gate):

## Recovery and review

- Rollback or compensating recovery:
- Known risks or approved exceptions:
- Independent reviewer:
- Product owner sign-off:
