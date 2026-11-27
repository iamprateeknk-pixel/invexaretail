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

**Current replay path.** The app sends the original `requestId` to the existing count endpoints. PostgreSQL commits the receipt, the count rows, and any configured Studio event together. The receipt binds the ID to the company, submitting user, and normalized count input. A matching retry returns the committed result using the user's current role. Reusing the same ID with changed input returns a 409 and the app shows the item in its Conflict Center. Older count rows with a request ID can still be replayed after comparing their stored location, item, mode, lot and quantity where available.

Assigned lot and pooled counts now carry an opaque stock revision from `GET /mobile/work`. The app keeps the revision from the first quantity entry through local storage and replay. PostgreSQL checks the relevant stock inside the count transaction. If it changed, the count and receipt are rolled back and Sync Center keeps the old quantity with a recount prompt. A completed request can still replay after later stock changes. Counts created without a revision retain the existing behavior.

Deploy the revision-aware API before the native pilot. The staged rollback target must also support count revisions while native clients can still have revision-bearing counts in their queues.

The typed command envelope and common versioned replay for pick, receive and putaway remain open. Verify the complete offline journey on physical devices before release.

Transfer receiving checks the company's transfer and destination inside the receipt transaction. Concurrent API requests with the same receipt ID use one transaction result, and the receiving account can recover that receipt after a restart. The existing global receipt ID constraint and receipt payload format are unchanged.

## Mobile store - `mobile/lib/services/native_database.dart`

Real SQLite (`sqlite3` package), replacing the earlier JSON file that only imitated SQLite.

- Location: application-support directory (`invexa_drift.sqlite`), WAL mode.
- Versioned migrations tracked in `PRAGMA user_version`; a database newer than the app is refused, not downgraded. Each migration and every multi-row write runs in one transaction (a failing write rolls back completely).
- Tables (schema v4): `sync_commands` is the single outbox - queued counts and actions are rows of type `COUNT` / `ACTION` (the legacy `queued_counts`/`queued_actions` tables were migrated into it and dropped), alongside typed offline commands. Columns: `command_id` PK, tenant, actor, type, entity, `base_version`, payload, `status` PENDING/SYNCED/CONFLICT/REJECTED, `attempts`, `last_error`, `server_version`), `entity_versions`.
- `enqueueCommand` is idempotent on `commandId`; commands replay in creation order per company; attempts, errors and conflicts survive process death; a conflicted command can be rebased and retried.
- The active count and action queues share one replay per sign-in session. Each confirmed send is saved before replay advances, so concurrent sync requests and newly captured work do not replace pending items. Signing out stops further sends and leaves in-flight work with its original account and request ID for a safe retry.
- **No secrets in SQLite.** Sessions and refresh tokens live in Keychain/Keystore-backed `flutter_secure_storage` (`SecureLocalStore`). `DriftStore` deliberately stores no session.
- The custom XOR `SyncVault` was removed - it was never wired to a production key, and the database is app-private. No app-layer crypto remains; add a reviewed AEAD library only if a threat model requires it.

### Upgrade / user impact (decision)

On first launch after upgrade, an existing `invexa_drift.sqlite` that is really the old JSON file is migrated in place: queued counts and actions are kept; the plaintext session, sealed envelopes (unopenable without the old key) and everything else are **discarded, then the file is deleted**. Users are signed in again once. Tested in `mobile/test/drift_store_test.dart`.

### Not done / not verified

- One outbox is in place at the storage layer (v4 migration, tested). Typed offline commands (`enqueueCommand`, conflict versions) are still not produced by the app screens, and `SessionController.flushQueue` still drains count/action rows through the existing per-type send paths.
- Cold-start-offline, crash-during-transaction on a real device, camera permission flows and physical-device navigation tests were not run (no device in this environment). The native count/pick/receive/putaway/scan screens already existed; their behaviour on hardware is unverified.
- Orders destination now shows a native read-only list from `GET /api/v1/orders` (it opened Transfers by mistake). The full-workspace WebView is pinned to trusted hosts and now grants **camera only**; every other permission request is denied.
