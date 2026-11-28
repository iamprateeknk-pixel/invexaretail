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

**Current replay path.** The app retains the original `requestId` when replaying, and the API uses the normal count handler. PostgreSQL commits the receipt, the count rows, and any configured Studio event together. The receipt binds the ID to the company, submitting user, and normalized count input. A matching retry returns the committed result using the user's current role. Reusing the same ID with changed input returns a 409 and the app shows the item in its Conflict Center. Older count rows with a request ID can still be replayed after comparing their stored location, item, mode, lot and quantity where available.

Assigned lot and pooled counts now carry an opaque stock revision from `GET /mobile/work`. The app keeps the revision from the first quantity entry through local storage and replay. PostgreSQL checks the relevant stock inside the count transaction. If it changed, the count and receipt are rolled back and Sync Center keeps the old quantity with a recount prompt. A completed request can still replay after later stock changes. Counts created without a revision retain the existing behavior.

`GET /runtime/config` now returns `offlineCountPermit` for roles whose published offline scope includes counts. The permit is issued and expires on server time, and is valid only for the same company, user, and role. Flutter caches the permit with that role's settings. It saves the original permit, request ID and stock revision with a queued count and sends those values together on replay. If the API supports permits and a current permit or task revision is unavailable, Flutter keeps the entered quantity in Sync Center for recount and leaves it out of automatic replay. The server checks the current published policy for a new submission. A matching committed receipt can still be recovered after permission is revoked or the permit expires. The permit cannot authenticate a request by itself. Existing clients and queued counts from before this change continue using the original count contract.

Deploy the API with stock revision and offline permit checks before the native pilot. The staged rollback target must also support both checks while native clients can still have these counts in their queues. Verify a queued permitted count and a revoked count against both images during the staged rollback drill.

For a new permit-bearing count, PostgreSQL rechecks the submitting user's active role and the published offline policy before saving. Count commits and Studio policy publication coordinate per company. If a revocation commits first, the count and the pending receipt both roll back. A matching receipt for an earlier completed count remains replayable.

The operational API accepts version 2 commands at `POST /api/v1/sync/commands`. A command carries its type, entity, request ID, opaque revision, permit and workflow payload. The API derives the actor and company from the current session and supplies the request to the existing workflow through its normal authorization and policy checks. Responses are the workflow's existing receipt or error. Flutter uses this endpoint when runtime settings advertise version 2 and the saved work fits its command schema. Permit-bearing work can still use the individual workflow endpoints on an older API that verifies those permits. A server that lacks permit support leaves permit-bearing work pending and visible in Sync Center. Queues created before permits still use their original workflow endpoints. Verify the complete offline journey on physical devices before release.

The API issues separate warehouse permits in `runtime.offlineWarehousePermits` for `picks`, `receiving` and `putaway` when the published role scope allows them. Flutter saves the original permit, task revision and request identity together and replays them after restart. New commits verify the permit and current published permission inside the warehouse transaction. A matching committed receipt can still replay after expiry or revocation. Work captured without a usable permit or revision on a permit-capable API stays in Sync Center for a fresh scan. Older clients and queues continue using the previous request format during rollout. Keep permit-aware API images available throughout the pilot and rollback while permits can remain in a device queue.

Picker task detail includes a revision covering the assignment, requested lines, saved slips and relevant source stock. The app queues one pending slip per transfer and retains the original revision and request ID. PostgreSQL checks the current revision and saves the slip and transfer status in one transaction. New slips bind replay to the pick input before server lot allocation. Matching retries recover the committed slip, and a changed submission with the same request ID returns a conflict. Historical slips retain their original request ID lookup. A stale slip stays in Sync Center for review, and the operator must refresh and scan again. The supervisor's later transfer-out confirmation remains a separate stock-posting step.

Transfer-out locks the same transfer row as pick-slip saves. Before posting source stock, it checks that the status, locations and slip IDs still match those used for approval evaluation. A change returns a conflict so the supervisor can refresh and review the updated transfer.

Transfer receiving checks the company's transfer and destination inside the receipt transaction. Matching requests with the same receipt ID recover one result, even after restart. New receipts bind the ID to the submitted quantities, notes, inspections and revision before QC can reclassify a line. Reusing the ID for a different submission returns a conflict. Receipts saved before the nullable fingerprint was added keep their original lookup. The migration leaves historical rows and the existing global request ID constraint intact.

The transfer list and carton lookup issue a receiving revision for receivable transfers. The app keeps the revision from the opened transfer with the queued receipt. PostgreSQL verifies it against the locked transfer and lines before recording stock. A stale receipt stays in Sync Center until the operator refreshes and checks the remaining quantities. An already committed receipt can still replay. Keep a revision-aware API available during the native pilot and rollback while devices have queued receipts.

Native putaway preserves the task's last update time with the scanned bin. PostgreSQL saves the confirmation, staging debit, destination credit, movement record and audit together. A retry by the same operator for the same destination returns the confirmation proven by that movement. If the task changed, the app keeps the saved scan and asks the operator to refresh and rescan. Older confirmations without a movement record keep their existing resolved response.

During the native pilot, keep putaway revision checks available on the rollback API while devices have queued confirmations.

## Mobile store - `mobile/lib/services/native_database.dart`

Real SQLite (`sqlite3` package), replacing the earlier JSON file that only imitated SQLite.

- Location: application-support directory (`invexa_drift.sqlite`), WAL mode.
- Versioned migrations tracked in `PRAGMA user_version`; a database newer than the app is refused, not downgraded. Each migration and every multi-row write runs in one transaction (a failing write rolls back completely).
- Tables (schema v4): `sync_commands` is the single outbox - queued counts and actions are rows of type `COUNT` / `ACTION` (the legacy `queued_counts`/`queued_actions` tables were migrated into it and dropped), alongside typed offline commands. Columns: `command_id` PK, tenant, actor, type, entity, `base_version`, payload, `status` PENDING/SYNCED/CONFLICT/REJECTED, `attempts`, `last_error`, `server_version`), `entity_versions`.
- `enqueueCommand` is idempotent on `commandId`; commands replay in creation order per company; attempts, errors and conflicts survive process death; a conflicted command can be rebased and retried.
- The active count and action queues share one replay per sign-in session, ordered by the capture times stored in SQLite. A temporary failure pauses all newer pending work until the next attempt. Conflicts remain visible for an operator's decision. Each confirmed send is saved before replay advances. Signing out stops further sends and leaves in-flight work with its original account and request ID for a safe retry.
- Sessions and refresh tokens live in platform-backed `flutter_secure_storage` (`SecureLocalStore`). SQLite holds each signed permit with the work it covers. Replaying it requires a valid session for the same company, user and role.
- The custom XOR `SyncVault` was removed - it was never wired to a production key, and the database is app-private. No app-layer crypto remains; add a reviewed AEAD library only if a threat model requires it.

### Upgrade / user impact (decision)

On first launch after upgrade, an existing `invexa_drift.sqlite` that is really the old JSON file is migrated in place: queued counts and actions are kept; the plaintext session, sealed envelopes (unopenable without the old key) and everything else are **discarded, then the file is deleted**. Users are signed in again once. Tested in `mobile/test/drift_store_test.dart`.

### Not done / not verified

- The app stores count and action records in the shared outbox and builds the version 2 command at replay time when the server supports it. Existing queue records retain the individual-endpoint compatibility path.
- Cold-start-offline, crash-during-transaction on a real device, camera permission flows and physical-device navigation tests were not run (no device in this environment). The native count/pick/receive/putaway/scan screens already existed; their behaviour on hardware is unverified.
- Orders destination now shows a native read-only list from `GET /api/v1/orders` (it opened Transfers by mistake). The full-workspace WebView is pinned to trusted hosts and now grants **camera only**; every other permission request is denied.
