# CI security scanning + replacing SyncVault's hand-rolled cipher

Closes two items named directly in the 20-Week Developer Execution Guide
(Week 19's CI/security scope, and Week 16's "replace custom SyncVault/XOR
design with standard authenticated encryption or remove unnecessary
app-layer crypto") that were still open as of Week 33.

## 1. CI security scanning (Week 19)

Before this change, `.github/workflows/ci.yml` ran build/test/lint/contract
checks but no SAST, dependency, or secret scanning at all - `grep -rl
"codeql\|semgrep" .github` returned nothing. Added `.github/workflows/security.yml`:

- **CodeQL** (`javascript-typescript`, `security-and-quality` query pack) on
  every PR/push to `main` and weekly on a schedule.
- **gitleaks** secret scan on every PR/push (full history via
  `fetch-depth: 0`).
- **`npm audit --audit-level=high`** for `api/`, `web/` and `admin-panel/`
  as a matrix job. Deliberately non-blocking for now (`|| echo
  "::warning::..."`) - the same "report existing separately from new"
  pattern this repo already uses for `architecture-lint`'s baseline, since
  the current advisory backlog (if any) hasn't been triaged yet. Promote to
  a hard failure once that triage happens.

Also added `.github/dependabot.yml` covering `api/`, `web/`,
`admin-panel/` (npm), `mobile/` (pub) and the workflow files themselves
(github-actions), weekly.

Container/image scanning from the guide's Week 19 scope is not applicable
here - the repo has no Docker/container build step (Render/Railway/
Cloudflare all deploy from source).

## 2. SyncVault: hand-rolled cipher to AES-256-GCM (Week 16)

`mobile/lib/services/sync_vault.dart` encrypted the offline mutation queue
with a **custom construction**: an HMAC-SHA256-keyed keystream (counter-mode
PRF blocks) XORed against the plaintext, then a separate HMAC-SHA256 tag
over `companyId|iv|ciphertext`, checked with a constant-time compare. This
has a real encrypt-then-MAC shape and wasn't trivially broken, but it is
still hand-rolled cryptography - exactly what AGENTS.md's #5 prohibited
pattern and the Week 16 guide text both call out by name ("Replace custom
SyncVault/XOR design with standard authenticated encryption").

Replaced with **AES-256-GCM via PointyCastle** (`pointycastle: ^3.9.1`, a
maintained, widely-used pure-Dart crypto library - chosen over the
`cryptography` package specifically because PointyCastle's API is
synchronous, so `SyncVault.seal`/`.open`'s existing synchronous signatures
- and every call site in `sync_engine.dart` - needed zero changes):

- Key: `SHA-256("invexa-sync-vault-v2|<companyId>|<secret>")`, truncated to
  32 bytes. This is a key-derivation step, not the cipher itself - AES-GCM
  provides the actual confidentiality/integrity guarantee.
- Nonce: 12 random bytes per `seal()` call (`Random.secure()`), standard
  GCM nonce length.
- AAD: the `companyId`, so a ciphertext's authentication tag is bound to
  the company it was sealed under - the tamper-detection property the old
  code got from its separate HMAC now comes from the GCM tag itself.
- Envelope bumped to `'v': 2`; the companyId mismatch check still runs
  before any decryption is attempted (unchanged behavior, still throws
  `StateError('SYNC_VAULT_COMPANY_MISMATCH')` first).

No caller changed: `sync_engine.dart`'s `enqueue`/`openSealed` and every
persistence path (`local_store.dart`, `drift_store.dart`,
`native_database.dart`) treat sealed envelopes as opaque strings and were
untouched.

## Testing

New `mobile/test/sync_vault_test.dart` - the old `SyncVault` had no
dedicated test file, only indirect coverage via `sync_engine_test.dart`'s
cross-tenant checks (which still pass unchanged). Added what that coverage
never exercised:

- round-trip for the owning company;
- two seals of the same payload produce different ciphertexts (nonce
  actually varies);
- **ciphertext tampering is rejected** (flip one byte, confirm
  `SYNC_VAULT_MAC_INVALID` via `throwsStateError`) - the one property a
  hand-rolled cipher is most likely to get subtly wrong and the old suite
  never checked;
- wrong secret, same company - rejected;
- wrong company - rejected before decryption is attempted.

This session's sandbox has no Flutter/Dart SDK, so these changes could not
be run locally (`flutter pub get`/`flutter test`/`dart analyze` all
unavailable here). Verification relies on the repository's existing
`mobile` CI job (`.github/workflows/ci.yml`), which does have a real
Flutter toolchain (`subosito/flutter-action@v2`) and already runs `flutter
pub get`, `flutter analyze --no-fatal-infos` and `flutter test` on every
PR - this PR must be watched through that job rather than assumed green.

## What's unaffected

`local_store.dart`, `drift_store.dart`, `native_database.dart`,
`secure_store.dart` and the offline sync protocol are untouched - they
only ever see `SyncVault`'s output as an opaque string, exactly as before.
`flutter_secure_storage` (already used for refresh credentials, per Week
16's other requirement) is unaffected by this change.
