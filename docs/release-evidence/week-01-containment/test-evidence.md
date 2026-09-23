# Unchanged baseline test evidence

The test suite was not altered for this Week 1 evidence. Results labeled audited baseline were run from detached commit `57eb95044cf98cde505eb0c4702e94b61643cd04` after deterministic lockfile installation. Mobile results were run from the Week 1 working checkout because the lockfile recovery affected only npm projects.

| Area | Command | Result | Date/runner | Evidence link |
| --- | --- | --- | --- | --- |
| API schema | `npm run db:validate --prefix api` | Passed | 22 September 2026, audited baseline | `lockfile-recovery.md` |
| API tests | `npm test --prefix api` | Passed: 545 passed, 1 skipped, 0 failed | 22 September 2026, audited baseline | `lockfile-recovery.md` |
| API build | `npm run build --prefix api` | Passed | 22 September 2026, audited baseline | `lockfile-recovery.md` |
| Root production build | `npm run build` | Passed using `npm ci --prefix api` | 22 September 2026, Week 1 checkout | Local command output |
| Web tests | `npm test --prefix web` | Passed: 102 passed, 0 failed | 22 September 2026, audited baseline | `lockfile-recovery.md` |
| Web lint | `npm run lint --prefix web` | Passed with existing warnings | 22 September 2026, audited baseline | `lockfile-recovery.md` |
| Web build | `npm run build --prefix web` | Passed with existing chunk-size warning | 22 September 2026, audited baseline | `lockfile-recovery.md` |
| Mobile analysis | `flutter analyze --no-fatal-infos` from `mobile/` | Passed: no issues found | 22 September 2026, Week 1 checkout | Local command output |
| Mobile tests | `flutter test` from `mobile/` | Passed: 64 passed, 1 live-API test skipped | 22 September 2026, Week 1 checkout | Local command output |
| DB integration | CI MySQL migration and integration coverage | Passed | 22 September 2026, PR #19 | [CI run 35719052402](https://github.com/iamprateeknk-pixel/invexaretail/actions/runs/35719052402) |
| Complete CI workflow | API, admin panel, web and mobile jobs | Passed: 4 of 4 jobs | 22 September 2026, commit `816605c` | [CI run 35719052402](https://github.com/iamprateeknk-pixel/invexaretail/actions/runs/35719052402) |
| Secondary verification | API and web jobs using deterministic installs | Passed: 2 of 2 jobs | 22 September 2026, commit `816605c` | [verification run 35719052438](https://github.com/iamprateeknk-pixel/invexaretail/actions/runs/35719052438) |

## Notes

- The root package build installs API dependencies and is not a substitute for the complete API, web, and mobile evidence above.
- Database-backed integration tests must use an explicitly isolated test database. They must not reuse staging or production.
- A failed suite is evidence, not a reason to change business behavior during Week 1.
- The skipped API test requires an isolated MySQL database. The skipped mobile test requires an approved live staging endpoint.
- API tests emitted expected development/test warnings for unavailable database-backed non-blocking work and still completed with zero failures.
- Pull request #19 completed all six GitHub Actions jobs successfully under the repository-pinned toolchains. The primary API job also deployed migrations to its isolated MySQL service, ran integration coverage, tested startup diagnostics, and verified the health endpoint.
