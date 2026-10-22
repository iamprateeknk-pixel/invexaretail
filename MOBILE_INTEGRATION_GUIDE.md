# Mobile App Integration Guide

This guide describes the mobile app **as it exists in `mobile/` today**: a
native Flutter client (Dart SDK `>=3.7.0 <4.0.0`, app version `1.3.0+4`) for
warehouse and store-floor work — counts, stock lookup, transfers, picking,
putaway, receiving, orders and expiry handling. The committed platform
project is Android (`mobile/android/`); there is no iOS project in the repo.

> Earlier revisions of this guide described a Riverpod + Hive architecture
> with `*_provider.dart` files. That design was never implemented and has
> been removed from this document. State management is a hand-rolled
> `ChangeNotifier`; local persistence is SQLite via the `sqlite3` package.

## Architecture

```
Mobile App (Flutter, mobile/)
    │  HTTP/REST + authenticated SSE
    ▼
Backend API (api/, Node.js/Express)
    │
    ▼
PostgreSQL (or in-memory seed mode when DATABASE_URL is unset)
```

### Code layout (`mobile/lib/`)

| Area | Files | Notes |
| --- | --- | --- |
| Entry | `main.dart`, `app.dart` | App wiring |
| Models | `models/models.dart` | JSON is parsed by hand — there is no code generation and no `build_runner` |
| State | `state/session_controller.dart` | `SessionController extends ChangeNotifier` is the single app-state controller |
| Services | `services/` | `api_client.dart` (REST), `live_events.dart` (SSE), `native_database.dart` (SQLite), `secure_store.dart`, `local_store.dart`, `drift_store.dart`, `sync_resolution.dart`, plus scan/pick/label helpers |
| Screens | `screens/` | login, dashboard, home shell, stock, counts, transfers, new transfer, receive, pick, putaway, orders, scan, expiry detail, conflict center, workspace (WebView) |

Key dependencies (from `mobile/pubspec.yaml`): `http`,
`flutter_secure_storage`, `shared_preferences`, `sqlite3`, `path_provider`,
`mobile_scanner` (barcode scanning), `webview_flutter` (full web workspace),
`pdf` + `printing` (label PDFs).

## Authentication

- Login is `POST /api/v1/auth/login`; the client also uses
  `/api/v1/auth/refresh-token`, `/api/v1/auth/logout`,
  `/api/v1/auth/send-otp`, `/api/v1/auth/verify-otp`,
  `/api/v1/auth/2fa/verify-login` and `/api/v1/auth/web-handoff`
  (see `services/api_client.dart`).
- The session and refresh credentials are stored **only** in
  `flutter_secure_storage` (Keychain/Keystore-backed) via the `SessionVault`
  in `services/secure_store.dart`. They are never written to the SQLite
  database or to plain preferences.
- The API base URL is set at run/build time:
  `flutter run --dart-define=INVEXA_API_BASE=http://127.0.0.1:4000`.
  When `INVEXA_API_BASE` is empty the app uses
  `https://invexaretail-api-production.up.railway.app`.

## Local persistence and offline behaviour

- The on-device database is a real SQLite file opened through the
  `sqlite3` package in `services/native_database.dart`. The schema is
  versioned with ordered migrations tracked in `PRAGMA user_version`;
  `currentSchemaVersion` is **5**. `services/drift_schema.sql` mirrors the
  same migrations as a reference script — `native_database.dart` is
  authoritative.
- Offline mutations go into one durable outbox table, `sync_commands`,
  which implements the server contract in
  `api/src/lib/offline-command-contract.ts`. Commands are company-scoped,
  carry the actor and the base entity version, and track status/attempts so
  they can be replayed and audited. Related tables: `entity_versions`
  (last known server versions) and `device_meta` (per-installation device
  id that tags queued work).
- The v5 `read_model` table caches the last successful response of each
  read-only screen feed, scoped to company + user, so a cold start with no
  network still shows the last known stock/items/tasks, marked as a
  snapshot. It never holds credentials and is removed on sign-out.
- Stock ledger rows are never stored on device.
- Sync conflicts are surfaced in the conflict center screen
  (`screens/conflict_center_screen.dart`, `services/sync_resolution.dart`)
  rather than being silently overwritten.

## Realtime updates

While the app is in the foreground it holds an authenticated SSE stream
(`services/live_events.dart`). Events are payload-free invalidations: the
app refetches only the slices an event names, instead of polling whole
screens.

## Full web workspace

Home → browser icon opens `https://invexaretail.com/` in a trusted-host
WebView (only `invexaretail.com` and `api.invexaretail.com`), so admin
modules that exist only on web remain reachable from the app
(`screens/workspace_screen.dart`).

## Build and test

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
```

Release AAB/APK builds run in the `Build Invexa Retail Android release`
GitHub Actions workflow (`.github/workflows/android-apk.yml`), which builds
the committed `android/` project as-is with a pinned Flutter toolchain and
release signing from repository secrets.
