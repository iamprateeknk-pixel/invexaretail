# Mobile setup

Point the app at an API with:

```bash
flutter run --dart-define=INVEXA_API_BASE=http://127.0.0.1:4000
```

Empty `INVEXA_API_BASE` uses `https://invexaretail.com`.

Seed/demo logins are created by the API seed (`api/prisma/seed.ts`, or the
API's in-memory seed mode when `DATABASE_URL` is unset). Their password is
whatever you set in the `SEED_PASSWORD` environment variable — see
`api/.env.example` and `DEVELOPMENT_SETUP.md`. The password is deliberately
not printed in this document.

## iOS

Needs a Mac with Xcode for local runs (`flutter run -d ios`). For signed
release builds in CI, add these repository secrets (Settings → Secrets and
variables → Actions), then run the "Build Invexa Retail iOS release" workflow:

| Secret | What it is |
|---|---|
| `IOS_CERTIFICATE_P12_BASE64` | Apple Distribution certificate exported from Keychain as `.p12`, then `base64 -i cert.p12` |
| `IOS_CERTIFICATE_PASSWORD` | the password set when exporting that `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | App Store provisioning profile for `com.invexaretail.invexaretailMobile`, base64 |
| `IOS_TEAM_ID` | 10-character Team ID from developer.apple.com → Membership |

The resulting `.ipa` artifact uploads to TestFlight/App Store Connect with
Transporter. Without these secrets, `main` builds fail on purpose rather than
publish an IPA nobody can install; pull requests still build unsigned.

## iOS without an Apple Developer account

Without the four signing secrets, the iOS workflow still builds: it uploads an
**unsigned** `InvexaRetail-iOS-<version>-unsigned.ipa` artifact (Actions → the
"Build Invexa Retail iOS release" run → Artifacts). iOS will not install an
unsigned app, so re-sign it with a free Apple ID:

1. Install [Sideloadly](https://sideloadly.io) (Windows or macOS) or AltStore.
2. Connect the iPhone by USB, drop the `.ipa` in, sign in with your Apple ID.
3. On the iPhone: Settings → General → VPN & Device Management → trust the
   developer profile, then open Invexa Retail.

Limits of a free Apple ID: the signature expires after **7 days** (re-sign to
keep using it) and works on at most **3 devices**. Fine for testing; for staff
use either the paid account above or the web app:

**Web app on iPhone (no account, no expiry):** open `https://invexaretail.com` in
Safari → Share → **Add to Home Screen**. It installs with its icon and runs
full-screen (it is a PWA: `web/public/manifest.webmanifest` + service worker).

## Windows

`flutter run -d windows` needs Windows 10/11 with Visual Studio 2022 and the
"Desktop development with C++" workload. The in-app workspace and Control
Panel use the Microsoft Edge WebView2 Runtime, preinstalled on Windows 11 and
current Windows 10; on a PC without it the app shows a message asking to install it. CI needs no secrets. Optional code
signing (removes the SmartScreen "Unknown publisher" warning): set
`WINDOWS_CERTIFICATE_PFX_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`.
