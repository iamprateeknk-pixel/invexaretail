# Invexa Retail mobile

Native Flutter operations client for floor counts, stock, and transfers. The
full web workspace remains available as an in-app browser for admin modules.
Android, iOS and Windows native project scaffolds are checked in. Android has
the signed release workflow; Windows opens the trusted workspace in the system
browser and supports USB scanner/manual entry. Windows release and iOS simulator
builds run in CI; Apple signing, store submission and physical-device validation
remain release work.

## What it talks to

The app calls the same inventory API as the web portal:

- `POST /api/v1/auth/login`
- `GET /api/v1/dashboard`
- `GET /api/v1/locations`
- `GET /api/v1/items`
- `GET /api/v1/stock/:locationId`
- `GET /api/v1/counts`
- `POST /api/v1/stock-counts`
- `GET /api/v1/transfers/list`
- `GET /api/v1/count-assignments/mine`

There is no code generation. Models parse JSON by hand so CI does not need
`build_runner`.

## Run locally

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=INVEXA_ENV=development
```

Development uses the local API on port 4000 and web workspace on port 5173.
Set `INVEXA_API_BASE` and `INVEXA_WEB_APP_URL` with `--dart-define` to override
those origins when running on a device that cannot reach the host's loopback.
Use a device reachable HTTPS workspace to exercise the embedded browser on
Android and iOS, where platform rules can block local HTTP pages.
Production uses the existing public endpoints by default. For a staging build,
set `INVEXA_ENV=staging` and supply both staging HTTPS origins explicitly:

```bash
flutter run --dart-define=INVEXA_ENV=staging --dart-define=INVEXA_API_BASE=https://api.example.test --dart-define=INVEXA_WEB_APP_URL=https://workspace.example.test
```

Use the same defines with each native build command and replace the example
origins with the actual staging endpoints. Register the staging workspace
origin with that API before testing the sign-in handoff.
Sessions, offline queues, and cached reads are stored separately for each API
target. Existing installs on the default production endpoint retain their store.

Live API checks (optional):

```bash
INVEXA_API_BASE=http://127.0.0.1:4000 flutter test test/live_api_test.dart
```

## Offline counts

If `POST /api/v1/stock-counts` cannot reach the API, the count is stored on
device and replayed on the next successful refresh.

## Full workspace

Home → browser icon opens the configured workspace origin in a WebView or
the default browser on Windows.

## Published offline settings

Refresh once online after upgrading to download the policy and snapshots for
the current role. Studio controls which downloaded feeds can be read offline
and how long those snapshots can be used. A zero-hour limit disables snapshot
use. Scope or time changes take effect when the app refreshes the published
policy. The durable queue for unsent work is separate from downloaded reads.

## Android APK

The `android/` project is committed and is exactly what CI builds — the
Android release workflow (`.github/workflows/android-apk.yml`) does not
regenerate it. The workflow runs `flutter pub get --enforce-lockfile`,
`flutter analyze` and `flutter test`, then builds the signed release
AAB/APK with the version from `pubspec.yaml`.

## iOS app

`ios/` is committed (bundle id `com.invexaretail.invexaretailMobile`, iOS 15+).
`.github/workflows/ios.yml` runs on macOS. With the Apple signing secrets set,
`main`/manual runs build a signed App Store / TestFlight IPA (`SETUP.md`, "iOS").
Without them (and on every pull request) it uploads an unsigned IPA that can be
side-loaded with a free Apple ID (`SETUP.md`, "iOS without an Apple Developer
account"). Camera scanning and the embedded workspace work as on Android.

## Windows app

`windows/` is committed. `.github/workflows/windows.yml` builds a portable zip
and a per-user `InvexaRetail-Setup-<version>.exe` (Inno Setup script in
`windows/installer/`, no admin rights needed). Two platform differences, both
decided in one place (`lib/config/platform_caps.dart`):

- **Scanning:** no camera scanner exists on Windows, so every "Scan" opens a
  focused field instead. A USB/Bluetooth barcode scanner types the code plus
  Enter into it, so scanning works hands-free like on a phone.
- **Side menu:** on Windows every screen sits in one side menu (extended with
  labels on wide windows). The full web workspace is a menu tab inside the app
  (Microsoft Edge WebView2, `lib/screens/desktop_web_screen.dart`), already
  signed in as the app user via a one-time code; switching tabs keeps each one
  open. Rights are the web app's own: its menus follow the user's role
  (`web/src/lib/permissions.js`) and the API re-checks every request.
- **ADMIN:** lands on the Workspace tab, keeps every native screen, and gets a
  Control panel tab (the same rule as the web app's `adminOnly` sections). It
  opens `https://admin.invexaretail.com` and still asks for its own platform
  sign-in - a company ADMIN is not automatically a platform administrator.
  Other roles land on their usual screen and get the Workspace tab, never the
  Control panel.
- **Shared PCs:** each open starts with no cookies and no stored web session,
  and the workspace does not open at all if the sign-in code cannot be fetched,
  so one person never lands in another person's session. Only
  `invexaretail.com` hosts load inside the app; other links open in the browser.
- **Build note:** `webview_windows` 0.4.0 still uses MSVC's experimental
  coroutines; `windows/CMakeLists.txt` defines
  `_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS` for that plugin so the
  current Visual Studio builds it. When a future MSVC drops
  `<experimental/coroutine>`, replace the plugin (e.g. `flutter_inappwebview_windows`).

Wide windows (Windows, iPad, tablets in landscape) use a side navigation rail
instead of the bottom bar.

Run locally on a Windows PC with Visual Studio 2022 ("Desktop development with
C++"): `flutter run -d windows`.
