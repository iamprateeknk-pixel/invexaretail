# Offline command contract and mobile local store (Weeks 12 and 16)

## Server contract - `api/src/lib/offline-command-contract.ts`

Version **1**. A device queues *commands*, not state. Each command is:

| Field | Meaning |
|---|---|
| `contractVersion` | Must equal the server's version, else `REJECTED / CONTRACT_VERSION` |
| `commandId` | Client UUID; also the idempotency key. A retry re-sends the same id |
| `type` | `COUNT_SUBMIT`, `PICK_CONFIRM`, `RECEIVE_CONFIRM`, `PUTAWAY_CONFIRM` |
| `companyId`, `actorId` | Must match the authenticated session, else `REJECTED / TENANT_MISMATCH` (never trusted from the payload) |
| `entityType`, `entityId`, `baseVersion` | What it changes and the entity version the device last saw |
| `occurredAt` | Device time, informational only - never used for ordering |
| `payload` | Command body |

`evaluateOfflineCommand()` returns one of:

- `DUPLICATE` - `commandId` already applied: return the original result, apply nothing (each command syncs exactly once);
- `CONFLICT` - the server's entity version is newer than `baseVersion`: surfaced to the user, never silently overwritten;
- `REJECTED` - malformed, wrong version, or wrong tenant/actor;
- `READY` - safe to apply through the normal domain service (which posts stock only via `InventoryPostingService`).

**Status: contract + decision logic + tests only - deliberately not wired.** In practice the app already syncs safely without it: each queued count/action carries a client `requestId` that the existing endpoints treat idempotently, and a 409 moves the item to the Conflict Center for a user decision (`sync_resolution.dart`, `p4_workflows_test.dart`). What this contract adds is a per-entity *version* check (stale-write detection) and one uniform envelope. Adopting it needs (a) a server route with a persisted applied-command store dispatching to the count/pick/receive/putaway services and (b) the screens enqueuing into `sync_commands`. Both change user-facing behaviour and should be verified on a device, so they were not switched on blind.

## Mobile store - `mobile/lib/services/native_database.dart`

Real SQLite (`sqlite3` package), replacing the earlier JSON file that only imitated SQLite.

- Location: application-support directory (`invexa_drift.sqlite`), WAL mode.
- Versioned migrations tracked in `PRAGMA user_version`; a database newer than the app is refused, not downgraded. Each migration and every multi-row write runs in one transaction (a failing write rolls back completely).
- Tables (schema v4): `sync_commands` is the single outbox - queued counts and actions are rows of type `COUNT` / `ACTION` (the legacy `queued_counts`/`queued_actions` tables were migrated into it and dropped), alongside typed offline commands. Columns: `command_id` PK, tenant, actor, type, entity, `base_version`, payload, `status` PENDING/SYNCED/CONFLICT/REJECTED, `attempts`, `last_error`, `server_version`), `entity_versions`.
- `enqueueCommand` is idempotent on `commandId`; commands replay in creation order per company; attempts, errors and conflicts survive process death; a conflicted command can be rebased and retried.
- **No secrets in SQLite.** Sessions and refresh tokens live in Keychain/Keystore-backed `flutter_secure_storage` (`SecureLocalStore`). `DriftStore` deliberately stores no session.
- The custom XOR `SyncVault` was removed - it was never wired to a production key, and the database is app-private. No app-layer crypto remains; add a reviewed AEAD library only if a threat model requires it.

### Upgrade / user impact (decision)

On first launch after upgrade, an existing `invexa_drift.sqlite` that is really the old JSON file is migrated in place: queued counts and actions are kept; the plaintext session, sealed envelopes (unopenable without the old key) and everything else are **discarded, then the file is deleted**. Users are signed in again once. Tested in `mobile/test/drift_store_test.dart`.

### Not done / not verified

- One outbox is in place at the storage layer (v4 migration, tested). Typed offline commands (`enqueueCommand`, conflict versions) are still not produced by the app screens, and `SessionController.flushQueue` still drains count/action rows through the existing per-type send paths.
- Cold-start-offline, crash-during-transaction on a real device, camera permission flows and physical-device navigation tests were not run (no device in this environment). The native count/pick/receive/putaway/scan screens already existed; their behaviour on hardware is unverified.
- Orders destination now shows a native read-only list from `GET /api/v1/orders` (it opened Transfers by mistake). The full-workspace WebView is pinned to trusted hosts and now grants **camera only**; every other permission request is denied.
