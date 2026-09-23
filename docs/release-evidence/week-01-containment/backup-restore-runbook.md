# Isolated staging backup and restore rehearsal

## Purpose and boundary

Use this procedure only for the named staging database. It must never be run against production without a separately approved production recovery change. Store generated dumps and checksum files in approved encrypted storage, not in this repository.

## Preconditions

1. A staging owner has confirmed the isolated source and restore database identifiers.
2. The restore target is empty, isolated, access-controlled, and cannot route traffic to production.
3. Credentials are injected by the secret manager or local secure shell environment; they are never pasted into a command history, ticket, PR, or evidence file.
4. A tested application artifact matching the selected baseline is available.

## Rehearsal procedure

1. Record the source schema migration/version and critical-table row counts.
2. Create a consistent logical backup with the platform-approved MySQL/MariaDB backup mechanism.
3. Record UTC start/end, elapsed time, dump size, encrypted-storage reference, and SHA-256 checksum.
4. Restore into the isolated target using a newly created database/schema.
5. Compare schema version, critical-table row counts, and representative integrity checks (foreign keys, required inventory records, and selected read-only API responses).
6. Start the exact staging artifact against the restored target. Run `/health`, `/ready`, authentication, and read-only smoke checks.
7. Stop the rehearsal, retain only approved encrypted recovery artifacts, and rotate any credential exposed accidentally.

## Disposable local rehearsal

When Docker Desktop is healthy, run the repository-supplied rehearsal from the repository root:

```text
pwsh -File scripts/week1-local-restore-rehearsal.ps1
```

The script accepts only a repository-local SQL input, creates uniquely named MySQL 8.4 source and restore containers on an isolated Docker network, generates a logical backup, restores it, compares schema checksums and exact row counts, writes sanitized evidence under `docs/release-evidence/week-01-containment/local-restore-run/`, and removes the containers and network. It never connects to staging or production.

This local rehearsal verifies the recovery mechanism but does not replace the required isolated-staging restore using the current staging backup.

### Local rehearsal result

The final rehearsal completed on 22 September 2026 in 38.917 seconds using `mysql:8.4`:

- Backup checksum recorded: `1EFC15C568056B6F1B4847E20C0944AE5D8BB5B4BEC5517F865203F24FC94F0D`.
- Normalized source and restored schema hashes matched.
- All 10 tables had identical source and restored row counts.
- SQL dumps and raw schema files were removed after hashing.
- Both disposable containers, the isolated network, and the temporary work directory were removed.

Machine-readable results are stored in `local-restore-run/summary.json` and `local-restore-run/row-counts.csv`.

## Redacted command shape

```text
# Values come from a secret manager; do not replace placeholders in this repository.
mysqldump --single-transaction --routines --events --host "$STAGING_DB_HOST" --user "$STAGING_DB_USER" "$STAGING_DB_NAME" > "$APPROVED_SECURE_BACKUP_PATH"
sha256sum "$APPROVED_SECURE_BACKUP_PATH"
mysql --host "$ISOLATED_RESTORE_HOST" --user "$ISOLATED_RESTORE_USER" "$ISOLATED_RESTORE_DB" < "$APPROVED_SECURE_BACKUP_PATH"
```

Use the hosting provider's documented equivalent if it is the authoritative backup mechanism. The evidence record must identify the tool version and exact flags used without exposing credentials.

## Evidence record

| Field | Result |
| --- | --- |
| Rehearsal date/time (UTC) | Pending |
| Source/target identifiers (non-secret) | Pending |
| Backup mechanism and version | Pending |
| Start/end/elapsed | Pending |
| Encrypted artifact reference | Pending |
| SHA-256 checksum | Pending |
| Source/target schema version | Pending |
| Critical table row-count comparison | Pending |
| Integrity checks | Pending |
| Health, auth, and read-only smoke result | Pending |
| RTO/RPO observation | Pending |
| Failure recovery performed | Pending |
| Reviewer | Pending |

## Failure recovery

If the restore fails, keep the original backup immutable, discard only the isolated target, capture sanitized logs, correct the runbook, and repeat against a newly created isolated target. Do not continue to later weeks based on a partial restore.
