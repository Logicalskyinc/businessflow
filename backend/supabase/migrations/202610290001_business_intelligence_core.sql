-- BusinessFlow Intelligence core tables.
-- Shared GrowthFlow Supabase project; BusinessFlow-owned tables use the businessflow_ prefix.
-- Phase 1 is owner-only. Do not expose service-role credentials to browsers.
-- This migration is present in the connected GrowthFlow project history. Verify the target database before applying elsewhere.

create table public.businessflow_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 160),
  business_type text,
  business_description text,
  primary_goal text,
  onboarding_answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(onboarding_answers) = 'object'),
  country_code text not null default 'CI' check (country_code ~ '^[A-Z]{2}$'),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Membership records are groundwork for future teams. Phase 1 deliberately
-- permits only the business owner to create their own owner membership.
create table public.businessflow_memberships (
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.businessflow_goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  metric_name text check (metric_name is null or char_length(metric_name) <= 120),
  target_value numeric,
  current_value numeric not null default 0,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businessflow_experiments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 200),
  hypothesis text check (hypothesis is null or char_length(hypothesis) <= 4000),
  success_metric text check (success_metric is null or char_length(success_metric) <= 500),
  status text not null default 'draft' check (status in ('draft', 'planned', 'running', 'completed', 'cancelled')),
  result_summary text check (result_summary is null or char_length(result_summary) <= 8000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is null or started_at is null or completed_at >= started_at)
);

create table public.businessflow_memory (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  category text not null check (category in ('business_context', 'decision', 'observation', 'preference', 'lesson', 'experiment_result')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  source text not null default 'user' check (source in ('user', 'businessflow', 'grey', 'integration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businessflow_profiles_owner_idx on public.businessflow_profiles(owner_user_id);
create index businessflow_memberships_user_idx on public.businessflow_memberships(user_id, business_id);
create index businessflow_goals_business_idx on public.businessflow_goals(business_id, status);
create index businessflow_experiments_business_idx on public.businessflow_experiments(business_id, status);
create index businessflow_memory_business_idx on public.businessflow_memory(business_id, category, created_at desc);

-- Maintain timestamps consistently even when writes do not come through the API.
create function public.businessflow_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger businessflow_profiles_updated_at
before update on public.businessflow_profiles
for each row execute function public.businessflow_set_updated_at();

create trigger businessflow_goals_updated_at
before update on public.businessflow_goals
for each row execute function public.businessflow_set_updated_at();

create trigger businessflow_experiments_updated_at
before update on public.businessflow_experiments
for each row execute function public.businessflow_set_updated_at();

create trigger businessflow_memory_updated_at
before update on public.businessflow_memory
for each row execute function public.businessflow_set_updated_at();

-- RLS is the primary database boundary. Browser-supplied business IDs alone
-- never grant access; every child-table policy checks the authenticated owner.
alter table public.businessflow_profiles enable row level security;
alter table public.businessflow_memberships enable row level security;
alter table public.businessflow_goals enable row level security;
alter table public.businessflow_experiments enable row level security;
alter table public.businessflow_memory enable row level security;

create policy businessflow_profiles_owner_select on public.businessflow_profiles
for select to authenticated using (owner_user_id = (select auth.uid()));

create policy businessflow_profiles_owner_insert on public.businessflow_profiles
for insert to authenticated with check (owner_user_id = (select auth.uid()));

create policy businessflow_profiles_owner_update on public.businessflow_profiles
for update to authenticated using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

create policy businessflow_memberships_self_select on public.businessflow_memberships
for select to authenticated using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy businessflow_memberships_owner_insert on public.businessflow_memberships
for insert to authenticated with check (
  user_id = (select auth.uid())
  and role = 'owner'
  and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy businessflow_goals_owner_all on public.businessflow_goals
for all to authenticated using (
  exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
) with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy businessflow_experiments_owner_all on public.businessflow_experiments
for all to authenticated using (
  exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
) with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy businessflow_memory_owner_all on public.businessflow_memory
for all to authenticated using (
  exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
) with check (
  (created_by is null or created_by = (select auth.uid()))
  and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

-- No anonymous/public table access. Authenticated access remains constrained by RLS.
revoke all on public.businessflow_profiles from anon, public;
revoke all on public.businessflow_memberships from anon, public;
revoke all on public.businessflow_goals from anon, public;
revoke all on public.businessflow_experiments from anon, public;
revoke all on public.businessflow_memory from anon, public;

grant select, insert, update on public.businessflow_profiles to authenticated;
grant select, insert on public.businessflow_memberships to authenticated;
grant select, insert, update, delete on public.businessflow_goals to authenticated;
grant select, insert, update, delete on public.businessflow_experiments to authenticated;
grant select, insert, update, delete on public.businessflow_memory to authenticated;
