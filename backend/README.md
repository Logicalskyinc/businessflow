# BusinessFlow backend

This directory contains BusinessFlow's API and its internal Business Intelligence module.

## Current API

- `GET /health` — process health.
- `GET /api/business-intelligence/health` — reports implemented business intelligence capabilities.
- `GET /api/v1/ai/health` — reports the first-party BusinessFlow AI engine and its implementation boundary.
- `POST /api/v1/ai/analyze` — calculates workspace analysis from saved imports, goals, experiments, and memory.
- `POST /api/v1/ai/recommendations` — returns deterministic, evidence-based recommendations.
- `POST /api/v1/ai/chat` — returns a first-party reasoning response for a workspace and prompt.
- `GET /api/business-intelligence/onboarding/questions` — returns deterministic onboarding questions.
- `POST /api/business-intelligence/onboarding/validate` — validates answers without saving.
- `POST /api/business-intelligence/onboarding` — verifies a Supabase access token and persists a business profile under the authenticated user.
- `GET /api/business-intelligence/businesses` — lists only business profiles visible to the authenticated user under database RLS.
- `GET/POST /api/business-intelligence/goals` and `PATCH/DELETE /api/business-intelligence/goals/:id` — authenticated goal management.
- `GET/POST /api/business-intelligence/experiments` and `PATCH/DELETE /api/business-intelligence/experiments/:id` — authenticated experiment management.
- `GET/POST /api/business-intelligence/memory` and `PATCH/DELETE /api/business-intelligence/memory/:id` — authenticated structured business-memory records.

For goal, experiment, and memory list/create requests, supply `business_id` as a UUID. Listing accepts an optional `limit` from 1 to 100. Database RLS still determines whether the verified user can access that business. The CRUD endpoints persist structured records. BusinessFlow AI uses a first-party deterministic reasoning engine and does not require an external AI provider.

### Persist onboarding

Send an authenticated request:

```http
POST /api/business-intelligence/onboarding
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
```

```json
{
  "name": "My Business",
  "answers": {
    "business_basics": "We sell shoes to local customers.",
    "primary_goal": "Increase repeat customers",
    "current_baseline": "About 20 repeat customers per month",
    "constraints": "Small marketing budget",
    "success_measure": "Increase repeat customers by 15%"
  }
}
```

The backend derives `owner_user_id` from the verified token, never from request JSON. A database trigger creates the initial owner membership atomically. The request-scoped Supabase client uses the public/anon key plus the user's JWT, so Row Level Security is still enforced. Never use the service-role key for this route.

## Environment

Copy `.env.example` to your local environment and set:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (the project's publishable/anon key, never a service-role key)
- optionally `PORT` and `NODE_ENV`

The deployed backend will need the same values in its hosting provider's secret/environment settings. No production hosting variables have been changed by this commit.

## Run locally

Requires Node.js 20 or newer.

```sh
cd backend
npm install
npm test
npm start
```

The server listens on port 3000 by default. Set `PORT` to change it.

## Database

BusinessFlow uses its own `businessflow_`-prefixed tables in the existing GrowthFlow Supabase project:

- `businessflow_profiles` — owner and onboarding/business context.
- `businessflow_memberships` — initial owner membership and groundwork for future teams.
- `businessflow_goals` — goals and measurable progress.
- `businessflow_experiments` — hypotheses, status, and results.
- `businessflow_memory` — structured business context, decisions, observations, preferences, and lessons.

The following migrations are present in the connected GrowthFlow project's migration history:

- `202610290001_business_intelligence_core`
- `202610290002_businessflow_owner_membership_trigger`

The core migration creates the five tables with RLS and owner-based policies. The second migration ensures profile creation also creates the owner membership within the same database transaction. The migration history and resulting schema were inspected in the connected GrowthFlow project; this does not mean the application has passed production end-to-end testing. A transaction-based smoke test with two authenticated identities verified that the second user could not read another user's profile, goals, or membership, or insert a goal into that business. Test data was rolled back.

These are initial owner-only policies. Membership roles are groundwork only; team access is not enabled yet. We still need automated repeatable RLS integration tests and a fuller authorization review before treating this as production-ready.

## Architecture boundary

- **BusinessFlow frontend:** customer-facing onboarding, dashboards, goals, experiments, and reports.
- **Business Intelligence module:** owns business context, onboarding, metrics interpretation, recommendations, experiments, and business memory as each capability is implemented.
- **Grey:** a future internal orchestrator for approved cross-capability tasks. BusinessFlow should retain core functionality if Grey is unavailable.
- **GreyFlow:** a future content-generation provider behind explicit cost, permission, and action-approval controls.

## BusinessFlow AI boundary

BusinessFlow AI is a first-party backend capability, mounted at `/api/v1/ai`. It reads only the authenticated user's selected workspace through a user-scoped Supabase client and the existing RLS policies. It provides deterministic intent classification, evidence extraction, and recommended next steps using saved business records.

This first version is not a trained language model. It does not call OpenAI, Groq, or another external model provider, and it does not execute business actions. Its health response reports `engine: businessflow_ai_rules_v1`, `provider: first_party_deterministic`, `externalProviderRequired: false`, and `trainedLanguageModel: false`. Persistent BusinessFlow Intelligence conversations now use this same reasoning engine.

The frontend currently points at the configured BusinessFlow API URL in `frontend-config.js`. Deployment configuration and the live application still need release verification. The onboarding validation endpoint remains validation-only; persistent onboarding is handled by the authenticated `POST /api/business-intelligence/onboarding` route.

Before expanding team access or adding privileged operations, add repeatable authenticated integration tests for cross-account isolation, deletion behavior, and membership authorization. Never trust a business ID supplied by the browser as authorization, and never expose a Supabase service-role key to the frontend.

## Existing Supabase advisor findings

The shared project's security advisor also reports two findings on existing GrowthFlow configuration: `growthflow_payment_events` has RLS enabled but no policies, and leaked-password protection is disabled. These were not changed as part of BusinessFlow work and should be reviewed separately.

## Browser origin configuration

The API permits browser requests from `https://logicalskyinc.github.io` by default. If the frontend is hosted elsewhere, set `BUSINESSFLOW_ALLOWED_ORIGINS` in the backend environment to a comma-separated list of exact origins (scheme and hostname, no path). The CORS middleware does not enable credentialed cookies; the API uses bearer tokens. Keep the frontend's Supabase publishable/anon key public and never expose a service-role key.

The frontend account panel supports Supabase email/password sign-in, account creation, sign-out, workspace selection, goal loading and CRUD calls, and an explicit local-goal import flow. The frontend's `apiBaseUrl` remains blank until the backend is deployed and verified, so these cloud calls are not currently live. Do not describe the app as cloud-synced until end-to-end tests confirm sign-in, workspace creation, goal persistence across reloads, and cross-account isolation.
