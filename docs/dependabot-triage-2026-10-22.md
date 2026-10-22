# Dependabot triage — 2026-10-22

Scope: all open pull requests in `iamprateeknk-pixel/invexaretail`, with a
full accounting of the 11 Dependabot PRs that were open at the 21 Oct 2026
audit (R15/final-gates follow-up). This document is a report only — no PR
was merged, closed, or commented on to produce it.

## Current state (22 Oct 2026)

- **Open PRs: 1** — #162 "Phase 5: DB-first stock reads (R1/R4)" (human,
  stacked branch). 
- **Open Dependabot PRs: 0.**
- The 11 Dependabot PRs open at audit time (#143–#153) were **all merged on
  2026-10-21**. Spot-checks against the current manifests confirm the
  merged versions are what the code now pins: `web/package.json` carries
  vite `^8.3.4`, react-hook-form `^7.90.0`, @radix-ui/react-label
  `^2.1.17`, @radix-ui/react-separator `^1.2.0`, @types/node `^26.6.5`;
  `mobile/pubspec.yaml` carries shared_preferences `^2.5.6` and sqlite3
  `^3.7.0`.

## The audit-time 11 — classification and verdict

| PR | Package (area) | From → To | Type | Risk note | Verdict |
| --- | --- | --- | --- | --- | --- |
| #143 | @opentelemetry/sdk-node (api) | 0.222.0 → 0.223.0 | minor (0.x) | 0.x minors may break per semver; observability-only blast radius | Merged — acceptable; the one class to changelog-check next time |
| #144 | @opentelemetry/instrumentation-http (api) | 0.222.0 → 0.223.0 | minor (0.x) | Same train as #143; auto-instrumentation behaviour can shift | Merged — acceptable, same note |
| #145 | express-rate-limit (api) | 8.7.0 → 8.7.1 | patch | Patch on a security-adjacent middleware; low risk | Merged — right call |
| #146 | @types/node (web) | 26.6.4 → 26.6.5 | patch | Types-only, no runtime effect | Merged — right call |
| #147 | dotenv (api) | 18.0.5 → 18.0.7 | patch | Patch; env loading is on the boot path but change class is minimal | Merged — right call |
| #148 | @radix-ui/react-label (web) | 2.1.15 → 2.1.17 | patch | Patch on a small primitive | Merged — right call |
| #149 | @opentelemetry/instrumentation-express (api) | 0.70.0 → 0.71.0 | minor (0.x) | Same OpenTelemetry note as #143/#144 | Merged — acceptable, same note |
| #150 | react-hook-form (web) | 7.89.0 → 7.90.0 | minor | Minor feature release; forms are mid-convergence in this repo, watch for behaviour drift | Merged — right call |
| #151 | vite (web) | 8.3.2 → 8.3.4 | patch | Patch on the build tool; build-only blast radius | Merged — right call |
| #152 | @radix-ui/react-separator (web) | 1.1.15 → 1.2.0 | minor | Minor on a presentational primitive; additive in practice | Merged — right call |
| #153 | shared_preferences (mobile, pub) | 2.5.5 → 2.5.6 | patch | Patch; wraps platform key-value stores | Merged — right call |

Counts: patch 6, minor 5 (three of them OpenTelemetry 0.x), major 0.
Recommendations applied retroactively: merge 11, hold 0, close 0 — the
queue was healthy and is now empty.

## Standing guidance for future Dependabot PRs

- **Patch bumps and types-only updates:** merge once the PR's CI is green.
- **Minor bumps of application libraries** (react-hook-form, Radix, vite):
  merge after CI; skim the changelog when the package touches forms,
  builds, or routing.
- **0.x minors (OpenTelemetry today):** treat as potentially breaking —
  hold for a changelog skim before merging, because semver allows breaking
  changes in 0.x minor releases.
- **Major bumps:** hold by default; they need a planned migration, not a
  drive-by merge.
- One honest caveat for the whole queue: these merges landed on the user's
  instruction to merge everything ready; CI on the merged result has not
  been independently re-verified from this triage. A red main would change
  the verdicts above from "merged, fine" to "merged, needs a fix-forward".
