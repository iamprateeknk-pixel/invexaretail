# Week 1 containment evidence index

This folder is the evidence record for the containment baseline. It records what can be reproduced locally and what still requires a named staging owner. It does not contain credentials, database dumps, or production data.

## Required gate

Week 2 must not begin until an isolated staging restore succeeds, every P0 risk has a named owner, and the audited baseline is reproducible.

## Current state

- Audited commit: `57eb95044cf98cde505eb0c4702e94b61643cd04`
- Local baseline tag: `audit-baseline-2026-09-21`
- Working branch: `codex/week1-containment`
- Current checkout at Week 1 start: `e42eee3529d49c6ca41ec07ff5b52583a2513e3f`
- Baseline relationship: the audited commit is an ancestor of the current checkout; the later checkout changes are listed in `baseline-reproduction.md` and are not represented as audited-baseline evidence.
- Remote deployment discovery: GitHub has no configured Environment, deployment history, Actions secret names or Actions variables. A dedicated Render staging topology is recommended but not approved or provisioned.

## Evidence contents

- `baseline-reproduction.md`: baseline identity and local verification record.
- `risk-register.md`: R1-R15 ownership and acceptance tracker. Prateek Choudhary is the recorded owner for every P0 risk.
- `environment-and-deployment-map.md`: discovered deployment paths and the canonical-staging decision record.
- `backup-restore-runbook.md`: redacted isolated-staging rehearsal procedure and evidence template.
- `local-restore-run/`: sanitized checksum, timing, schema, and row-count evidence from the disposable local rehearsal.
- `lockfile-recovery.md`: deterministic dependency recovery and exact-baseline verification.
- `secret-scan.md`: sanitized tracked credential scan result and limitations.
- `test-evidence.md`: commands and results from unchanged baseline suites.
- `../../../scripts/create-week1-github-governance.ps1`: idempotent milestone, label, and R1-R15 issue bootstrap; requires an authenticated GitHub CLI and accepts optional per-risk owners.

## GitHub governance bootstrap

GitHub governance was created on 2026-09-22:

- Milestone: [Week 1 - Containment and Recovery](https://github.com/iamprateeknk-pixel/invexaretail/milestone/1)
- Risk issues: R1-R15, repository issues [#4](https://github.com/iamprateeknk-pixel/invexaretail/issues/4) through [#18](https://github.com/iamprateeknk-pixel/invexaretail/issues/18)
- P0 assignee: `iamprateeknk-pixel` (Prateek Choudhary), verified on all eight P0 issues
- P1 risks remain marked `owner-required` for assignment before their target-week gates

The records can be reconciled safely by rerunning:

```powershell
.\scripts\create-week1-github-governance.ps1
```

P0 issues record Prateek Choudhary as their accountable owner by default. To add GitHub assignees, pass exact GitHub usernames keyed by risk ID, for example:

```powershell
.\scripts\create-week1-github-governance.ps1 -GitHubAssignees @{ R1 = "github-user"; R2 = "github-user" }
```

The script is safe to rerun: it reuses the milestone, updates labels, and skips exact-title issue matches. Risks without confirmed owners receive the `owner-required` label and remain gate blockers.

## Evidence handling

Attach sanitized command output, checksums, durations, row counts, health responses, traces, and screenshots to this folder or the linked pull request. Never commit dumps, `.env` files, access tokens, passwords, connection URLs containing credentials, or customer data.
