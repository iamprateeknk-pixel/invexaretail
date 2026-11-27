# Invexa Retail mobile

Native Flutter operations client for floor counts, stock, and transfers. The
full web workspace remains available as an in-app browser for admin modules.

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
flutter run --dart-define=INVEXA_API_BASE=http://127.0.0.1:4000
```

If `INVEXA_API_BASE` is empty, the app uses `https://invexaretail.com`,
matching web `VITE_API_BASE`.

Live API checks (optional):

```bash
INVEXA_API_BASE=http://127.0.0.1:4000 flutter test test/live_api_test.dart
```

## Offline counts

If `POST /api/v1/stock-counts` cannot reach the API, the count is stored on
device and replayed on the next successful refresh.

## Full workspace

Home → browser icon opens `https://invexaretail.com/` in a trusted-host
WebView (invexaretail.com and api.invexaretail.com only).

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
- **Full workspace:** opens in the default browser (no embedded web view on
  Windows). The one-time sign-in code is not passed, so it never lands in
  browser history; the workspace asks for sign-in itself.

Wide windows (Windows, iPad, tablets in landscape) use a side navigation rail
instead of the bottom bar.

Run locally on a Windows PC with Visual Studio 2022 ("Desktop development with
C++"): `flutter run -d windows`.
