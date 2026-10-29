# BusinessFlow backend

This directory is the first backend foundation for BusinessFlow. Business Intelligence is an internal backend module, not a separately deployed service.

## Current API scope

- `GET /health` reports API process health.
- `GET /api/business-intelligence/health` reports which module capabilities are available.
- `GET /api/business-intelligence/onboarding/questions` returns deterministic onboarding questions.
- `POST /api/business-intelligence/onboarding/validate` validates answers without saving them.
- Node's built-in test runner covers the onboarding domain validation.

## Run locally

Requires Node.js 20 or newer.

```sh
cd backend
npm install
npm test
npm start
```

The server listens on port 3000 by default. Set `PORT` to change it.

## Database foundation

The migration `supabase/migrations/202610290001_business_intelligence_core.sql` defines BusinessFlow-owned tables with a `businessflow_` prefix inside the shared GrowthFlow Supabase project:

- `businessflow_profiles` — owner and onboarding/business context.
- `businessflow_memberships` — groundwork for future teams; initial access is owner-only.
- `businessflow_goals` — goals and measurable progress.
- `businessflow_experiments` — hypotheses, status, and results.
- `businessflow_memory` — structured business context, decisions, observations, preferences, and lessons.

The migration enables RLS on all five tables, grants no table access to anonymous/public roles, and limits authenticated access with owner-based policies. Updated timestamps are maintained by database triggers. These tables are separate from the existing `growthflow_*` tables.

**Migration status (2026-10-29): applied to the shared GrowthFlow Supabase project.** The five BusinessFlow tables were verified in the live schema. A transaction-based smoke test using two existing authenticated identities verified that the second identity could not read the first identity's profile, goals, or membership and could not insert a goal into that business; all test data and temporary test objects were rolled back. The existing three `growthflow_*` tables and the prior migration history remained present and unchanged. This smoke test is useful evidence, but it is not a substitute for a repeatable automated RLS integration suite.

## Architecture boundary

- **BusinessFlow frontend:** customer-facing onboarding, dashboards, goals, experiments, and reports.
- **Business Intelligence module:** business context, onboarding, metrics interpretation, recommendations, experiments, and business memory as those capabilities are implemented.
- **Grey:** a future internal orchestrator for approved cross-capability tasks. BusinessFlow must retain useful core functionality when Grey is unavailable.
- **GreyFlow:** a future content-generation provider behind explicit cost, permission, and action-approval controls.

## Important limitations

This is a database foundation, not a production-ready AI backend. The current API does not yet connect to Supabase, persist onboarding answers, authenticate requests, enforce tenant access in the application layer, call an AI provider, read live business metrics, or execute external actions. The validation endpoint remains intentionally non-persistent and must not be treated as a completed signup flow.

Before enabling customer persistence, implement verified authentication, derive business access from the verified identity (never a browser-supplied owner or tenant ID), connect the backend using server-side credentials, and add repeatable integration tests for authorization. Never expose a Supabase service-role key to the browser. The service-role key bypasses RLS and must be kept in server-side secrets only.

## Existing Supabase advisor findings

The post-migration security advisor still reports two findings on the shared project: `growthflow_payment_events` has RLS enabled but no policies, and leaked-password protection is disabled. These findings predate BusinessFlow's migration and were not changed as part of this work. Review them separately before expanding payment or authentication functionality.
