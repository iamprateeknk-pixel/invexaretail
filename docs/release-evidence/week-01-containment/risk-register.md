# Audit risk register

Every item below needs a GitHub issue, a named accountable owner, an evidence link, and a tested rollback or recovery record before the relevant week can close. The `Unassigned` values are intentional blockers, not approvals.

| Risk | Audit issue | Priority | Target week | Accountable owner | Acceptance evidence | Rollback or recovery | Issue link |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Multiple stock truths | P0 | 6 | Prateek Choudhary | Canonical journal equals balance projection for golden data | Rebuild projection from immutable journal | [#4](https://github.com/iamprateeknk-pixel/invexaretail/issues/4) |
| R2 | Weak refresh lifecycle | P0 | 3 | Prateek Choudhary | Rotation, replay, revoke-all and restart tests pass | Revoke session families and force re-authentication | [#5](https://github.com/iamprateeknk-pixel/invexaretail/issues/5) |
| R3 | Cross-tenant query gaps | P0 | 4 | Prateek Choudhary | Overlapping-ID negative isolation suite passes | Disable affected route and investigate audit trail | [#6](https://github.com/iamprateeknk-pixel/invexaretail/issues/6) |
| R4 | Hybrid memory and database state | P1 | 6-8 | Unassigned | Durable state survives API and worker restart | Drain/replay durable outbox and rebuild projections | [#7](https://github.com/iamprateeknk-pixel/invexaretail/issues/7) |
| R5 | Non-atomic reservations | P0 | 7 | Prateek Choudhary | Oversubscription and duplicate-transition concurrency tests pass | Compensate reservation through canonical service | [#8](https://github.com/iamprateeknk-pixel/invexaretail/issues/8) |
| R6 | Float precision | P0 | 5 | Prateek Choudhary | Decimal migration reconciliation with approved rounding deltas | Restore backup or run approved compensating reconciliation | [#9](https://github.com/iamprateeknk-pixel/invexaretail/issues/9) |
| R7 | Runtime DDL and migration drift | P0 | 5 | Prateek Choudhary | Fresh, upgrade, restored, and rollback databases converge | Restore backup and execute tested migration rollback | [#10](https://github.com/iamprateeknk-pixel/invexaretail/issues/10) |
| R8 | Mobile fake SQLite and secret storage | P1 | 16 | Unassigned | Offline process-death, duplicate-sync and secure-storage evidence | Disable affected mobile release channel | [#11](https://github.com/iamprateeknk-pixel/invexaretail/issues/11) |
| R9 | Public DB fallback or brittle config | P0 | 3 | Prateek Choudhary | Config scan and production startup fail-closed tests pass | Rotate exposed credentials and disable unsafe deployment | [#12](https://github.com/iamprateeknk-pixel/invexaretail/issues/12) |
| R10 | No browser E2E gate | P1 | 10 | Unassigned | Golden browser journeys run in staging | Block release until manual validated fallback is approved | [#13](https://github.com/iamprateeknk-pixel/invexaretail/issues/13) |
| R11 | God routers and components | P1 | 8-9 | Unassigned | Module boundaries and focused ownership tests pass | Revert isolated refactor commit | [#14](https://github.com/iamprateeknk-pixel/invexaretail/issues/14) |
| R12 | Polling plus SSE scaling | P1 | 10 | Unassigned | Load and reconnect behavior meets approved budget | Degrade to bounded polling with monitoring | [#15](https://github.com/iamprateeknk-pixel/invexaretail/issues/15) |
| R13 | Upload boundary | P1 | 11,13 | Unassigned | Spoofed, oversized, and malicious input is rejected | Quarantine objects and revoke signed access | [#16](https://github.com/iamprateeknk-pixel/invexaretail/issues/16) |
| R14 | Deployment path drift | P0 | 1,8 | Prateek Choudhary | Canonical staging deployment and restore both succeed | Roll back to prior tagged artifact and restore data | [#17](https://github.com/iamprateeknk-pixel/invexaretail/issues/17) |
| R15 | Documentation drift | P1 | 18 | Unassigned | Clean-developer setup and runbook rehearsal pass | Correct documentation before release | [#18](https://github.com/iamprateeknk-pixel/invexaretail/issues/18) |

## Week 1 gate status

Ownership and issues recorded: Prateek Choudhary (`iamprateeknk-pixel`) owns all P0 risks (R1, R2, R3, R5, R6, R7, R9, and R14), and all R1-R15 GitHub issues are linked above. The Week 1 gate remains blocked until the isolated staging restore and canonical deployment-path evidence are complete.
