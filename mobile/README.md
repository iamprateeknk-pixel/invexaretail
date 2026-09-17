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

If `INVEXA_API_BASE` is empty, the app uses `https://invexaretail-h1ps.onrender.com`,
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

CI generates the Android project at build time (`flutter create --platforms=android`).
The `android/` tree is not committed.
