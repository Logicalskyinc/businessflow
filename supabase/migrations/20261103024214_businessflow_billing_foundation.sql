-- BusinessFlow billing foundation.
-- All billing data is isolated from the existing public application tables.
-- Access is restricted to the server-side service_role; browser roles receive no grants.

create schema if not exists billing;

revoke all on schema billing from public;
revoke all on schema billing from anon, authenticated;
grant usage on schema billing to service_role;

create table billing.plans (
  id uuid primary key default gen_random_uuid(),
  product_key text not null default 'businessflow'
    check (product_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  plan_key text not null
    check (plan_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 120),
  stripe_price_id text unique,
  billing_interval text
    check (billing_interval is null or billing_interval in ('month', 'year')),
  currency text
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  unit_amount bigint
    check (unit_amount is null or unit_amount >= 0),
  entitlements jsonb not null default '{}'::jsonb
    check (jsonb_typeof(entitlements) = 'object'),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_product_plan_key unique (product_key, plan_key)
);

create table billing.customers (
  business_id uuid primary key
    references public.businessflow_profiles(id) on delete cascade,
  owner_user_id uuid not null
    references auth.users(id) on delete restrict,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table billing.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.businessflow_profiles(id) on delete cascade,
  product_key text not null default 'businessflow',
  plan_key text,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null
    references billing.customers(stripe_customer_id) on delete restrict,
  stripe_price_id text not null,
  status text not null
    check (status in (
      'incomplete', 'incomplete_expired', 'trialing', 'active',
      'past_due', 'canceled', 'unpaid', 'paused'
    )),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscriptions_plan_fk
    foreign key (product_key, plan_key)
    references billing.plans(product_key, plan_key)
);

create index billing_subscriptions_business_status_idx
  on billing.subscriptions (business_id, status);

create index billing_subscriptions_customer_idx
  on billing.subscriptions (stripe_customer_id);

create table billing.entitlements (
  business_id uuid not null
    references public.businessflow_profiles(id) on delete cascade,
  feature_key text not null
    check (feature_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  enabled boolean not null default false,
  limit_value bigint
    check (limit_value is null or limit_value >= 0),
  value jsonb not null default '{}'::jsonb
    check (jsonb_typeof(value) = 'object'),
  source_plan_key text,
  updated_at timestamptz not null default now(),
  primary key (business_id, feature_key)
);

create table billing.events (
  stripe_event_id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  stripe_object_id text,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'failed')),
  attempts integer not null default 0
    check (attempts >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index billing_events_status_received_idx
  on billing.events (processing_status, received_at);

alter table billing.plans enable row level security;
alter table billing.customers enable row level security;
alter table billing.subscriptions enable row level security;
alter table billing.entitlements enable row level security;
alter table billing.events enable row level security;

revoke all on all tables in schema billing from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema billing to service_role;

alter default privileges for role postgres in schema billing
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema billing
  grant select, insert, update, delete on tables to service_role;
