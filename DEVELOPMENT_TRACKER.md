# BusinessFlow development tracker

Last reviewed: 2026-11-18

## Operating rules

- Work from feature branches and pull requests. Do not push development changes directly to `main`.
- Production deployment is locked until implementation, validation, and an explicit release approval are complete.
- The repository GitHub Pages workflow deploys from `main`; merging to `main` can publish the frontend. Do not merge this automation PR as a routine step.
- GitHub Actions is used for repeatable checks and reporting. It does not independently implement product features.
- Do not change billing, production secrets, Supabase configuration, Render configuration, or live integrations without explicit approval.
- Keep implementation, tests, commits, and deployments as separate status checkpoints.

## Automation

| Item | Status | Notes |
|---|---|---|
| Existing backend CI | Implemented and tested | `.github/workflows/businessflow-backend.yml`; latest audited run passed on 2026-11-09. |
| Scheduled quality workflow | Implemented on automation branch; not yet active on default branch | Runs JavaScript syntax checks and backend tests. Scheduled Tuesday-Sunday at 06:00 UTC; also supports manual dispatch after it is merged to the default branch. |
| Dependency lockfile | Needs attention | `backend/package-lock.json` was not present on the audited main branch, so the workflow currently uses `npm install`. Do not switch to `npm ci` until a lockfile is intentionally added and reviewed. |
| Automation PR | Pending | Review workflow and tracker before merge. Deployment remains locked. |

## Product work already in progress

| Workstream | Current status | Required next validation |
|---|---|---|
| PR #11: dataset intelligence and cloud-persisted workspace records | Implementation exists on its feature branch; validation incomplete | Run backend regression tests; verify authenticated CRUD and import flows; repeat cross-account isolation/RLS checks; test import retry behavior for duplicate prevention. |
| PR #12: phone-first navigation | Implementation exists on its feature branch; visual validation pending | Preview on iOS and desktop; verify navigation targets, safe areas, touch targets, and desktop navigation regression. |
| PR #8: Grey/OYOSKY assistant integration | Blocked | Implement and test the signed, tenant-scoped, read-only Grey integration endpoint; verify API configuration/secrets; run API and end-to-end smoke tests before any release. |
| PRs #4-#6: Grey chat backend bridge, idempotency, and persistent chat UI | Draft dependency chain; needs coordinated review | Inspect branch dependencies and validate request idempotency, tenant isolation, and persistent conversation behavior together. |
| PR #1: EMAN Content Studio prototype | Parked / not yet prioritized | Revisit only after higher-priority BusinessFlow work is validated. |

## Recommended execution order

1. Review and validate PR #11, starting with the backend test suite and data-isolation checks.
2. Validate PR #12 on mobile and desktop.
3. Resolve the Grey integration blocker in PR #8, then verify the dependent PR #4-#6 work as one coherent flow.
4. Reassess the remaining feature queue and select the next product milestone.
5. Only after all required checks pass, prepare a release review. Merging or deployment requires separate explicit approval.

## Checkpoint definitions

- **Planned:** agreed scope, not yet implemented.
- **Implemented:** code or workflow exists on a branch.
- **Tested:** relevant automated and manual checks have passed.
- **Committed:** the expected commit is visible on the intended branch.
- **Deployed:** verified in the target live environment.

A successful commit or CI run does not, by itself, mean a feature is complete or deployed.
