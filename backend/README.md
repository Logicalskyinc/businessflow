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

The migration enables RLS on all five tables, grants no table access to anonymous/public roles, and limits authenticated access with owner-based policies. Updated timestamps are maintained by database triggers. These tables are intentionally separate from the existing `growthflow_*` tables.

**Migration status:** committed to the feature branch only. It has not been applied to a Supabase project. Before applying it, run it against a disposable/test database, test RLS with at least two users and cross-business access attempts, review Supabase security/performance advisors, and verify that existing GrowthFlow tables and policies remain unchanged.

## Architecture boundary

- **BusinessFlow frontend:** customer-facing onboarding, dashboards, goals, experiments, and reports.
- **Business Intelligence module:** business context, onboarding, metrics interpretation, recommendations, experiments, and business memory as those capabilities are implemented.
- **Grey:** a future internal orchestrator for approved cross-capability tasks. BusinessFlow must retain useful core functionality when Grey is unavailable.
- **GreyFlow:** a future content-generation provider behind explicit cost, permission, and action-approval controls.

## Important limitations

This is a foundation, not a production-ready AI backend. The current API does not yet connect to Supabase, persist onboarding answers, authenticate requests, isolate tenants in the application layer, call an AI provider, read live business metrics, or execute external actions. The validation endpoint is intentionally non-persistent and must not be treated as a completed signup flow.

Before enabling customer persistence, implement verified authentication, derive business access from the verified identity (never a browser-supplied owner or tenant ID), connect the backend using server-side credentials, and add integration tests for authorization. Never expose a Supabase service-role key to the browser. The service-role key bypasses RLS and must be kept in server-side secrets only.
