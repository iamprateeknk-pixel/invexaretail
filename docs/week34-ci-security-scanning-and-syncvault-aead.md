# CI security scanning + removal of unnecessary SyncVault crypto

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

## 2. SyncVault: remove unnecessary app-layer crypto (Week 16)

`mobile/lib/services/sync_vault.dart` previously contained hand-rolled
encryption for an offline queue. It was not wired to a production key and the
database is app-private, while refresh credentials already use the platform
keystore through `flutter_secure_storage`. The guide explicitly permits
removing unnecessary app-layer crypto, so the vault and its crypto dependencies
were removed rather than retaining a second encryption layer without a reviewed
threat model.

Any future application-layer encryption needs an approved threat model and a
reviewed AEAD library; it must not restore a custom cipher.

## Testing

The removed vault's tests and dependencies were removed with it. Mobile
verification remains `flutter analyze` and `flutter test` under the existing
CI mobile job.

## What's unaffected

`local_store.dart`, `drift_store.dart`, `native_database.dart`,
`secure_store.dart` and the offline sync protocol remain unchanged.
