# BusinessFlow backend

This directory is the first backend foundation for BusinessFlow. The Business Intelligence capability is an internal module in the backend, not a separately deployed service.

## Current scope

- Express API with basic security headers and a request-body size limit.
- `GET /health` for service health.
- `GET /api/business-intelligence/health` to report which module capabilities are available.
- `GET /api/business-intelligence/onboarding/questions` to return deterministic onboarding questions.
- `POST /api/business-intelligence/onboarding/validate` to validate answers without saving them.
- Node's built-in test runner for the module's domain logic.

## Run locally

Requires Node.js 20 or newer.

```sh
cd backend
npm install
npm test
npm start
```

The server listens on port 3000 by default. Set `PORT` to change it.

## Architecture boundary

- **BusinessFlow frontend:** customer-facing onboarding, dashboards, goals, experiments, and reports.
- **Business Intelligence module:** business context, onboarding, metrics interpretation, recommendations, experiments, and business memory as those capabilities are implemented.
- **Grey:** a future internal orchestrator for approved cross-capability tasks. It is not called by this initial module.
- **GreyFlow:** a future content-generation provider behind explicit cost and permission controls.

## Important limitations

This is a foundation, not a production-ready AI backend. It does not currently connect to Supabase, persist onboarding answers, authenticate users, isolate tenants, call an AI provider, read live business metrics, or execute external actions. The validation endpoint is intentionally non-persistent and must not be treated as a completed signup flow.

Before storing customer data, add verified authentication, derive tenant/business membership from the authenticated identity, enforce tenant isolation in the database (including Supabase RLS if Supabase is selected), and add integration tests for authorization. Never trust a `tenant_id` or business owner identifier supplied by the browser.
