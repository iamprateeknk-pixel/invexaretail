# Baseline reproduction record

## Audited baseline

| Field | Value |
| --- | --- |
| Commit | `57eb95044cf98cde505eb0c4702e94b61643cd04` |
| Local tag | `audit-baseline-2026-09-21` |
| Guide date | 21 September 2026 |
| Branch for containment work | `codex/week1-containment` |

## Checkout relationship at Week 1 start

The checked-out commit was `e42eee3529d49c6ca41ec07ff5b52583a2513e3f`. The audited commit is its ancestor. The later checkout differs in the following paths:

- `api/src/index.ts`
- `api/src/lib/db.ts`
- `api/src/lib/request-metrics.ts`
- `api/src/routes/command-center.ts`
- `web/src/components/command/CommandCenter.jsx`
- corresponding generated files under `api/dist/`

This makes the audited revision available and reproducible, but the current checkout must not be treated as the audited baseline without a separate review of those later changes.

## Reproduction commands

Run these on a clean clone. Keep dependencies and generated artifacts outside version control unless the repository intentionally tracks them.

```text
git checkout 57eb95044cf98cde505eb0c4702e94b61643cd04
npm install --prefix api --ignore-scripts
npm install --prefix web --ignore-scripts
npm run db:validate --prefix api
npm test --prefix api
npm run build --prefix api
npm test --prefix web
npm run lint --prefix web
npm run build --prefix web
flutter pub get   # from mobile/
flutter analyze --no-fatal-infos
flutter test
```

The database-backed integration suite requires an isolated MySQL instance and an explicitly supplied test database URL. Do not point it at staging or production.
