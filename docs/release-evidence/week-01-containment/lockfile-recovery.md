# Audited baseline lockfile recovery

## Decision

Preserve audited source commit `57eb95044cf98cde505eb0c4702e94b61643cd04` and add reviewed npm lockfiles as Week 1 containment artifacts. The API and web package manifests are unchanged between the audited commit and the Week 1 branch starting commit.

## Generation environment

- Date: 22 September 2026
- Node: `v24.19.0`
- npm: `11.17.0`
- Command: `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`
- Source: detached worktree at the exact audited commit

The repository CI declares Node 22. Pull request #19 confirmed that both npm lockfile v3 files install and pass their jobs under the repository-pinned toolchain. The clean local installation and exact-baseline tests below used the recorded generation environment.

## Reviewed lockfiles

| Project | SHA-256 | Package entries | Resolution review |
| --- | --- | ---: | --- |
| API | `199E6D4CFCC90D1A8C24C06A94A2A0EE92D7502841E0020AB84BED269524429C` | 320 | Only `registry.npmjs.org`; no Git resolutions; all resolved packages have integrity metadata |
| Web | `7D4885BA3279A0364664B61C7CF20DCAAD618FA2F2129A720A1B33774971E8C6` | 171 | Only `registry.npmjs.org`; no Git resolutions; all resolved packages have integrity metadata |

## Exact baseline verification

API verification followed the repository CI order because Prisma Client must be generated before tests:

1. `npm ci --ignore-scripts --no-audit --no-fund`
2. `npm run db:validate`
3. `npm run build`
4. `npm test`

Result: schema validation passed, build passed, 545 tests passed, 0 failed, and 1 isolated-MySQL test was skipped.

Web verification:

1. `npm ci --ignore-scripts --no-audit --no-fund`
2. `npm test`
3. `npm run lint`
4. `npm run build`

Result: 102 tests passed, lint exited successfully with existing warnings, and the production build passed with an existing chunk-size warning.

## Remaining gate

The lockfile blocker is resolved for API and web locally and in CI. The local disposable-MySQL rehearsal is complete and P0 ownership is recorded. Week 1 still requires a restore in the real isolated staging environment and an approved canonical staging path.

## CI enforcement

The Week 1 branch now:

- tracks the API and web npm lockfiles despite the previous repository-wide ignore rule;
- uses `npm ci` for API and web jobs in both active verification workflows;
- builds Prisma Client before API tests in the secondary verification workflow; and
- uses `npm ci --prefix api` in the root production build command.

The updated root production build completed successfully on 22 September 2026.

Pull request #19 then passed both active workflows on commit `816605c`: four jobs in [CI run 35719052402](https://github.com/iamprateeknk-pixel/invexaretail/actions/runs/35719052402) and two jobs in [verification run 35719052438](https://github.com/iamprateeknk-pixel/invexaretail/actions/runs/35719052438).
