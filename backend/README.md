# BusinessFlow backend

This directory contains BusinessFlow's API and its internal Business Intelligence module.

## Current API

- `GET /health` — process health.
- `GET /api/business-intelligence/health` — reports implemented module capabilities.
- `GET /api/business-intelligence/onboarding/questions` — returns deterministic onboarding questions.
- `POST /api/business-intelligence/onboarding/validate` — validates answers without saving.
- `POST /api/business-intelligence/onboarding` — verifies a Supabase access token and persists a business profile under the authenticated user.
- `GET /api/business-intelligence/businesses` — lists only business profiles visible to the authenticated user under database RLS.
- `GET/POST /api/business-intelligence/goals` and `PATCH/DELETE /api/business-intelligence/goals/:id` — authenticated goal management.
- `GET/POST /api/business-intelligence/experiments` and `PATCH/DELETE /api/business-intelligence/experiments/:id` — authenticated experiment management.
- `GET/POST /api/business-intelligence/memory` and `PATCH/DELETE /api/business-intelligence/memory/:id` — authenticated structured business-memory records.

For goal, experiment, and memory list/create requests, supply `business_id` as a UUID. Listing accepts an optional `limit` from 1 to 100. Database RLS still determines whether the verified user can access that business. These endpoints persist structured records only; they do not infer insights or invoke an AI provider.

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
- optionally `OYOSKY_SERVICE_URL` and `OYOSKY_BUSINESSFLOW_SERVICE_TOKEN` to enable the explicit OYOSKY assistant mode. The token must match `OYOSKY_BUSINESSFLOW_SERVICE_TOKEN` on the OYOSKY service and must never be exposed to the browser.

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

## Not implemented yet

The backend code persists onboarding profiles and exposes authenticated CRUD endpoints for goals, experiments, and structured business-memory records. It also computes rule-based business insights and provides persistent, workspace-scoped conversations. An optional OYOSKY assistant mode now sends bounded workspace context from the authenticated backend to OYOSKY through a dedicated service credential. The OYOSKY endpoint currently uses deterministic ATLAS/ORBIT reasoning, not trained OYOSKY model weights. The frontend contains account authentication, workspace selection, goal loading, cloud goal CRUD, and an explicit local-goal import flow. The frontend's `apiBaseUrl` must still be configured and verified for the cloud experience to work. The `onboarding/validate` endpoint remains non-persistent. Grey and GreyFlow are not yet integrated into BusinessFlow, and no external actions are executed.

Before adding further customer data, implement and test the complete authorization flow, automated RLS integration tests, and server-side secret configuration. Never trust a business or tenant ID supplied by the browser, and never expose a Supabase service-role key to the frontend.

## Existing Supabase advisor findings

The shared project's security advisor also reports two findings on existing GrowthFlow configuration: `growthflow_payment_events` has RLS enabled but no policies, and leaked-password protection is disabled. These were not changed as part of BusinessFlow work and should be reviewed separately.

## Browser origin configuration

The API permits browser requests from `https://logicalskyinc.github.io` by default. If the frontend is hosted elsewhere, set `BUSINESSFLOW_ALLOWED_ORIGINS` in the backend environment to a comma-separated list of exact origins (scheme and hostname, no path). The CORS middleware does not enable credentialed cookies; the API uses bearer tokens. Keep the frontend's Supabase publishable/anon key public and never expose a service-role key.

The frontend account panel supports Supabase email/password sign-in, account creation, sign-out, workspace selection, goal loading and CRUD calls, and an explicit local-goal import flow. The frontend's `apiBaseUrl` remains blank until the backend is deployed and verified, so these cloud calls are not currently live. Do not describe the app as cloud-synced until end-to-end tests confirm sign-in, workspace creation, goal persistence across reloads, and cross-account isolation.

## OYOSKY assistant mode

The conversation API accepts `assistant_mode: "businessflow"` (default) or `assistant_mode: "oyosky"`. BusinessFlow loads the selected authenticated workspace's profile, goals, experiments, and bounded business-memory context on the backend. It sends that context to OYOSKY over HTTPS using a dedicated server-to-server bearer token. The browser never receives this credential.

Set `OYOSKY_SERVICE_URL` and `OYOSKY_BUSINESSFLOW_SERVICE_TOKEN` on the BusinessFlow backend. Set the same token as `OYOSKY_BUSINESSFLOW_SERVICE_TOKEN` on OYOSKY. The OYOSKY endpoint disables shared OYOSKY memory and rejects requests without its dedicated credential. If OYOSKY is unavailable, BusinessFlow returns an explicit error and does not silently substitute a different reasoning provider.

The current OYOSKY endpoint returns its deterministic ATLAS/ORBIT reasoning assessment. It does not use trained OYOSKY model weights, execute actions, or write OYOSKY memory. This integration is not live until both services are separately configured and deployed.

## Grey assistant mode

The conversation API accepts `assistant_mode: "grey"`. The authenticated BusinessFlow backend signs a short-lived HS256 token for the selected user and business workspace and sends it to the configured Grey HTTPS endpoint. The browser never receives the signing secret. Grey stores its own tenant-scoped persistent conversation history; BusinessFlow stores the returned Grey conversation ID to reconnect future turns.

Set `GREY_SERVICE_URL` and `GREY_BUSINESSFLOW_JWT_SECRET` on the BusinessFlow backend. Set the same secret as `GREY_BUSINESSFLOW_JWT_SECRET` on Grey. Grey also requires `GREY_CHAT_HISTORY_DATABASE_URL` for persistent history, replay protection and rate limits. If Grey or its history database is unavailable, BusinessFlow reports an explicit error and does not fall back to another assistant. The first migration adds the Grey conversation link column; apply migrations before enabling the integration.

BusinessFlow sends the selected workspace's business profile, goals, experiments and saved business memory. Users should choose Grey only when they are comfortable sharing that data with the configured Grey service. Grey treats this context as untrusted reference data and does not grant it owner memory permissions.

Each persisted BusinessFlow message records its selected assistant mode (`businessflow`, `oyosky`, or `grey`) so the interface can label older replies correctly after a refresh. Apply the `202611020002_businessflow_assistant_modes.sql` migration after the Grey conversation-link migration.

Grey retries use the UUID of the already-persisted BusinessFlow user message as `request_id`. If a request times out after Grey has saved its answer, BusinessFlow can retry the same message ID and Grey returns the original conversation and saved answer rather than appending another turn. The backend persists the Grey conversation ID before committing the assistant reply, so a failed BusinessFlow write can recover the same Grey conversation on retry.
