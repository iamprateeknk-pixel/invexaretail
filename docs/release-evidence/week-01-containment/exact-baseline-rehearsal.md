# Exact audited baseline rehearsal

## Resolution

Resolved locally on 22 September 2026. Reviewed API and web lockfiles were generated from the exact audited commit, clean installs succeeded, and the baseline suites passed. See `lockfile-recovery.md`. CI confirmation under Node 22 remains required before the gate is approved.

## Result

On 22 September 2026, commit `57eb95044cf98cde505eb0c4702e94b61643cd04` was checked out into a detached temporary worktree. The checkout resolved to the expected commit.

The deterministic dependency installation failed before tests could run:

- `api/` has no `package-lock.json` or `npm-shrinkwrap.json` at the audited commit.
- `web/` has no `package-lock.json` or `npm-shrinkwrap.json` at the audited commit.
- `npm ci --ignore-scripts --no-audit --no-fund` therefore exited with `EUSAGE` in both projects.

## Gate impact

The audited baseline cannot currently be reproduced deterministically from its committed files. Running `npm install` would resolve mutable version ranges and create new lockfiles, so that result must not be represented as an exact reproduction of the audited commit.

This original attempt established the blocker. The subsequent reviewed lockfile recovery resolves it without treating the later source changes as part of the audited baseline.

## Required decision

Choose and review one of these recovery paths:

1. Create lockfiles from the audited commit using the approved Node and npm versions, review the complete resolved dependency set, and tag the resulting containment commit as the reproducible baseline.
2. Review the later checkout, including its source changes and lockfiles, and formally approve it as a superseding baseline.

The temporary worktree contained no credentials or business data and was removed after the rehearsal.
