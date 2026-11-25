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
flutter run --dart-define=INVEXA_API_BASE=http://127.0.0.1:4000
```

If `INVEXA_API_BASE` is empty, the app uses `https://invexaretail-api-production.up.railway.app`,
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

## Windows and iOS

Windows release builds use `flutter build windows --release`; barcode input is
provided through a USB scanner or manual entry because the camera plugin does
not support Windows. iOS builds use `flutter build ios --simulator --no-codesign`
in macOS CI. Device signing, App Store/TestFlight publication, camera permission
validation and store review are not configured.
