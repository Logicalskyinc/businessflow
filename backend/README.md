# BusinessFlow backend

BusinessFlow's Node.js API and first-party business intelligence capability.

## API

- `GET /health`: process health.
- `GET /api/business-intelligence/health`: module capabilities.
- `GET /api/business-intelligence/onboarding/questions`: onboarding questions.
- `POST /api/business-intelligence/onboarding/validate`: validates answers only; does not save.
- `POST /api/business-intelligence/onboarding`: creates a business for the authenticated user.
- `GET /api/business-intelligence/businesses`: lists businesses visible under RLS.
- `GET /api/business-intelligence/insights?business_id=<uuid>`: workspace analytics and insights.
- `GET/POST /api/business-intelligence/imports`: list and save imports.
- `GET /api/business-intelligence/imports/:id?business_id=<uuid>`: retrieve one import.
- `GET/POST /api/business-intelligence/goals`, `PATCH/DELETE /api/business-intelligence/goals/:id`.
- `GET/POST /api/business-intelligence/experiments`, `PATCH/DELETE /api/business-intelligence/experiments/:id`.
- `GET/POST /api/business-intelligence/memory`, `PATCH/DELETE /api/business-intelligence/memory/:id`.
- `GET /api/business-intelligence/conversations?business_id=<uuid>`: list conversations.
- `POST /api/business-intelligence/conversations`: create a conversation.
- `GET /api/business-intelligence/conversations/:id/messages`: load messages.
- `POST /api/business-intelligence/conversations/:id/messages`: append a user message and obtain a persistent assistant reply.
- `GET /api/v1/ai/health`: AI implementation boundary.
- `POST /api/v1/ai/analyze`, `/recommendations`, `/chat`: authenticated workspace analysis and reasoning.

Business IDs are identifiers, not authorization. Every protected route uses the verified Supabase user token and user-scoped database client; RLS must enforce access. Goal, experiment, memory, import and conversation endpoints require a valid workspace UUID. Do not use a service-role key in browser code.

## Environment and local run

Requires Node.js 20 or newer.

Required:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (publishable/anon key, never service-role)

Optional:
- `PORT` (default 3000)
- `NODE_ENV`
- `BUSINESSFLOW_ALLOWED_ORIGINS` (comma-separated exact browser origins)

The default allowed origins are `https://logicalskyinc.github.io`, `https://growthflow-7tyx.onrender.com`, and `https://businessflow-gba5.onrender.com`. The API uses bearer tokens, not credentialed cookies.

```sh
cd backend
npm install
npm test
npm start
```

The test command is Node's built-in test runner. The cross-owner RLS integration test is skipped unless all four variables are set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BUSINESSFLOW_RLS_TEST_USER_TOKEN`, and `BUSINESSFLOW_RLS_TEST_FOREIGN_BUSINESS_ID`. Use a dedicated test identity and a workspace owned by a different dedicated test identity. That integration test performs read-only queries against profiles, goals, experiments, memory, imports and conversations and asserts RLS returns no foreign records. It does not create or delete test data.

## Database

BusinessFlow tables are isolated from GrowthFlow by the `businessflow_` prefix. They cover profiles, memberships, goals, experiments, memory, imports, conversations and messages.

Repository migrations:
- `20261029140844_businessflow_intelligence_core.sql`
- `20261029141124_businessflow_owner_membership_trigger.sql`
- `20261029201846_businessflow_imports.sql`
- `20261101073947_businessflow_existing_schema_baseline.sql`
- `20261101074003_businessflow_privilege_hardening.sql`

The baseline migration checks the existing schema; privilege hardening restricts direct table operations and secures the assistant-message RPC. The initial membership model creates an owner membership. Team-role access is not enabled merely because membership records exist. Apply migrations only through an explicitly reviewed migration process; do not assume the shared project has the same state as a fresh local database.

## BusinessFlow AI

BusinessFlow AI is a first-party deterministic reasoning service. Its health response identifies `engine: businessflow_ai_rules_v1`, `provider: first_party_deterministic`, `externalProviderRequired: false`, and `trainedLanguageModel: false`. It is not a trained language model and does not call OpenAI, Groq, or another external model provider. It does not execute external business actions.

The persistent conversation route loads the selected workspace's profile, imports, goals, experiments and memory, then calls the same reasoning service used by the AI API. User messages are stored with a client-generated idempotency key. Assistant replies are persisted through `businessflow_append_assistant_message`, which checks the authenticated user, conversation and parent user message. A duplicate request can return the existing reply instead of creating another one.

## Security and release checks

- Derive user identity from the verified bearer token, never request JSON.
- Treat every workspace ID as untrusted input and rely on RLS for authorization.
- Never expose the Supabase service-role key to the frontend.
- Keep cross-owner isolation tests enabled in a dedicated test environment before release.
- Test account creation, sign-in, workspace switching, CRUD persistence after reload, import limits, conversation retries, and deletion behavior with dedicated test accounts.
- Do not claim cloud sync or production readiness until frontend/API integration and isolation tests pass.

The shared Supabase project's security advisor previously reported findings on existing GrowthFlow configuration (`growthflow_payment_events` RLS policy coverage and leaked-password protection). Those are outside this BusinessFlow README change and need separate review.
