# BusinessFlow billing module

## Architecture

- Stripe secrets and Supabase service-role key stay on the backend.
- The existing Supabase Auth middleware verifies the caller and supplies a user-scoped client.
- Workspace billing is owner-only and scoped to `businessflow_profiles.id`.
- Billing tables live in the unexposed `billing` schema with RLS enabled and no browser grants.
- The backend uses service-role-only RPC functions in `public` to read/write billing data. Function EXECUTE is revoked from PUBLIC, anon and authenticated.
- Stripe webhooks are signature-verified against the raw request body before JSON parsing.
- Event IDs are unique. Subscription state and entitlements are updated inside one Postgres function transaction.
- Subscription snapshots are retrieved from Stripe instead of trusting delayed webhook payload snapshots.

## Routes

- `POST /api/billing/customer` body: `{ "business_id": "..." }`
- `POST /api/billing/checkout` body: `{ "business_id": "...", "plan_key": "..." }`; requires a unique UUID in the `Idempotency-Key` header.
- `POST /api/billing/portal` body: `{ "business_id": "..." }`
- `GET /api/billing/subscription?business_id=...`
- `GET /api/billing/entitlements?business_id=...`
- `POST /api/billing/webhook` Stripe webhook endpoint. Raw body required.

## Backend environment

Set these in the Render backend environment, not in frontend configuration:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` (sandbox during development)
- `STRIPE_WEBHOOK_SECRET`
- `BILLING_CHECKOUT_SUCCESS_URL`
- `BILLING_CHECKOUT_CANCEL_URL`
- `BILLING_PORTAL_RETURN_URL`

## Configure Stripe sandbox

Register the webhook endpoint:

`https://businessflow-api-2jmw.onrender.com/api/billing/webhook`

Subscribe to:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the sandbox webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

## Configure a plan

Create the sandbox Product and recurring Price in Stripe. Then insert a matching row into `billing.plans` with `product_key = 'businessflow'`, a stable `plan_key`, the Stripe Price ID, currency, amount, interval and an `entitlements` JSON object. Keep `active = false` until the plan has been reviewed.

Example entitlements:

```json
{
  "advanced_analytics": { "enabled": true },
  "monthly_ai_credits": { "enabled": true, "limit": 500 }
}
```

No live Stripe products, prices, subscriptions or charges are created by this implementation.


## Currency-specific prices

The plan catalogue is split into `billing.plans` (feature entitlements) and `billing.plan_prices` (Stripe Price IDs by currency and recurring interval). A plan can have XOF and NGN prices, with monthly and yearly variants. Checkout requires `business_id`, `plan_key`, `currency`, and `billing_interval` (`month` or `year`). Keep the plan and its price inactive until the price and entitlements have been reviewed.
