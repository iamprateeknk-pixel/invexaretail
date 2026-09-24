# Security gates (Week 19)

`.github/workflows/security.yml` runs on every PR to `main`, every push to `main`, weekly, and on demand.

| Gate | Tool | Blocks the build when |
|---|---|---|
| SAST | CodeQL, `security-extended` queries, JavaScript/TypeScript | Any alert is raised at the repository's code-scanning threshold (configure branch protection to require the check) |
| Dependency audit | `npm audit --omit=dev` for `api`, `web`, `admin-panel` | `web`: high or critical. `api`, `admin-panel`: **critical** (see exceptions) |
| Secret scan | gitleaks over the full history | Any leaked secret |
| Container image | Trivy on `api/Dockerfile` (HIGH/CRITICAL, unfixed ignored) | Any fixable HIGH/CRITICAL OS/package finding |

## Severity policy

- **Critical / high in production code or a runtime dependency**: fix before merge. No release with an open P0/P1 security issue (release scorecard, "Security").
- **Moderate / low**: reported, triaged in the release scorecard, may ship with an owner and expiry.
- **Secrets**: rotate first, then remove from history; never merely delete the line.

## Time-boxed exceptions

Recorded so the gate is honest about why it is not stricter. Each expires; renew only with a fresh look.

| Package | Finding | Why it is accepted | Owner | Expires |
|---|---|---|---|---|
| `api` | `mysql2 <=3.23` and `deepmerge-ts <8` (high) reached through `prisma` CLI -> `@prisma/dev` | Only used by the `prisma dev` local tooling, never loaded by the API, worker or migrations at runtime; the fix is a Prisma major downgrade (`prisma@6.19.3`) that would break the client. Re-check on each Prisma upgrade. | repo owner | 2026-12-31 |
| `admin-panel` | `vite <=6.4.2` / `esbuild <=0.24.2` (high/moderate) | Dev-server-only issue (any website can read dev-server responses); the shipped artifact is static assets. Fix needs Vite 8 (breaking). | repo owner | 2026-12-31 |

These were measured on 2026-09-25 with `npm audit --omit=dev` in each folder (`web`: 0 findings).

## Other controls already in code

- Helmet CSP and `express-rate-limit` (`api/src/index.ts`); OTP and login abuse controls (`lib/otp-auth.ts`, `lib/session-store.ts`).
- API keys are HMAC-hashed at rest, scoped, revocable and never re-displayed (`lib/saas/control-plane.ts`); rotation is a first-class audited operation (`POST /control/v1/integrations/api-keys/:id/rotate`: the replacement is issued and the old key revoked in one step; the new token is shown once).
- Evidence/photo uploads: magic-byte MIME check and 15 MB limit (`lib/transfer-evidence.ts`, `multer`). Evidence is served through short-lived (default 5 min, max 1 h), company-bound HMAC links (`routes/evidence-access.ts`, `lib/signed-access.ts`). **Not done:** malware scanning and object storage - both need infrastructure.
- Marketplace webhooks: HMAC signature, and (Week 15) SKU and fulfilment-location resolution scoped to the connector's own company.

## Not verified here

CSP has not been checked against the deployed web origin, and no penetration test or external scan was run. Those need the staging environment.
